import { action, observable, IComputedValue, computed, ObservableMap, runInAction } from "mobx";
import { CatalogEntity } from "../../common/catalog-entity";
import { catalogEntityRegistry } from "../../common/catalog-entity-registry";
import { kubeconfigSyncStore } from "../../common/kubeconfig-sync-store";
import { watch } from "chokidar";
import fs from "fs";
import uuid from "uuid";
import stream from "stream";
import { Singleton } from "../../common/utils";
import logger from "../logger";
import { KubeConfig } from "@kubernetes/client-node";
import { loadConfigFromString, splitConfig, validateKubeConfig } from "../../common/kube-helpers";
import { Cluster } from "../cluster";
import { catalogEntityFromCluster } from "../cluster-manager";

type Disposer = () => void;

export class KubeconfigSyncManager extends Singleton {
  protected sources = observable.map<string, [IComputedValue<CatalogEntity[]>, Disposer]>();
  protected syncing = false;
  protected syncListDisposer?: Disposer;

  protected getSyncName(file: string): string {
    return `lens:kube-sync:${file}`;
  }

  @action
  startSync(port: number): void {
    if (this.syncing) {
      return;
    }

    logger.info("[KUBECONFIG-SYNC]: starting requested syncs");

    for (const filePath of kubeconfigSyncStore.files) {
      this.startNewSync(filePath, port);
    }

    this.syncing = true;

    this.syncListDisposer = kubeconfigSyncStore.files.observe(change => {
      switch (change.type) {
        case "add":
          this.startNewSync(change.newValue, port);
          break;
        case "delete":
          this.stopOldSync(change.oldValue);
          break;
      }
    });
  }

  @action
  stopSync() {
    this.syncListDisposer?.();

    for (const filePath of this.sources.keys()) {
      this.stopOldSync(filePath);
    }

    this.syncing = false;
  }

  @action
  protected startNewSync(filePath: string, port: number): void {
    if (this.sources.has(filePath)) {
      // don't start a new sync if we already have one
      return;
    }

    logger.info("[KUBECONFIG-SYNC]: starting sync of file", { filePath });
    const changeSet = watchFileChanges(filePath, port);

    this.sources.set(filePath, changeSet);
    catalogEntityRegistry.addComputedSource(this.getSyncName(filePath), changeSet[0]);
  }

  @action
  protected stopOldSync(filePath: string): void {
    if (!this.sources.has(filePath)) {
      // already stopped
      return;
    }

    logger.info("[KUBECONFIG-SYNC]: stopping sync of file", { filePath });
    this.sources.delete(filePath);
    catalogEntityRegistry.removeSource(this.getSyncName(filePath));
  }
}

function configsToModels(configs: KubeConfig[], filePath: string) {
  const validConfigs = [];

  for (const config of configs) {
    try {
      validateKubeConfig(config, config.currentContext);
      validConfigs.push(config);
    } catch (error) {
      logger.debug(`[KUBECONFIG-SYNC]: context failed validation: ${error}`, { context: config.currentContext, filePath });
    }
  }

  return validConfigs.map(config => ({
    id: uuid.v4(),
    kubeConfigPath: filePath,
    contextName: config.currentContext,
  }));
}

type RootSourceValue = [Cluster, CatalogEntity];
type RootSource = ObservableMap<string, RootSourceValue>;

function computeDiff(buf: Buffer, source: RootSource, port: number, filePath: string): void {
  runInAction(() => {
    try {
      const kubeconfigs = splitConfig(loadConfigFromString(buf.toString("utf-8")));
      const rawModels = configsToModels(kubeconfigs, filePath);
      const models = new Map(rawModels.map(m => [m.contextName, m]));

      for (const [contextName, value] of source) {
        const model = models.get(contextName);

        // remove and disconnect clusters that were removed from the config
        if (!model) {
          value[0].disconnect();
          source.delete(contextName);
          logger.debug("[KUBECONFIG-SYNC]: Removed old cluster from sync", { filePath, contextName });
          continue;
        }

        // TODO: For the update check we need to make sure that the config itself hasn't changed.
        // Probably should make it so that cluster keeps a copy of the config in its memory and
        // diff against that

        // or update the model and mark it as not needed to be added
        value[0].updateModel(model);
        models.delete(contextName);
        logger.debug("[KUBECONFIG-SYNC]: Updated old cluster from sync", { filePath, contextName });
      }

      for (const [contextName, model] of models) {
        // add new clusters to the source
        try {
          const cluster = new Cluster(model);

          if (!cluster.apiUrl) {
            throw new Error("Cluster constructor failed, see above error");
          }

          const entity = catalogEntityFromCluster(cluster);

          entity.metadata.labels.KUBECONFIG_SYNC = filePath;
          source.set(contextName, [cluster, entity]);

          logger.debug("[KUBECONFIG-SYNC]: Added new cluster from sync", { filePath, contextName });
        } catch (error) {
          logger.warn(`KUBECONFIG-SYNC]: Failed to create cluster from model: ${error}`, { filePath, contextName });
        }
      }
    } catch (error) {
      logger.warn(`[KUBECONFIG-SYNC]: Failed to compute diff: ${error}`, { filePath });
      source.clear(); // clear source if we have failed so as to not show outdated information
    }
  });
}

function diffChangedConfig(filePath: string, source: RootSource, port: number): Disposer {
  // TODO: replace with an AbortController with fs.readFile when we upgrade to Node 16 (after it comes out)
  const fileReader = fs.createReadStream(filePath, {
    mode: fs.constants.O_RDONLY,
  });
  const readStream: stream.Readable = fileReader;
  const bufs: Buffer[] = [];
  let closed = false;

  readStream
    .on("data", chunk => bufs.push(chunk))
    .on("close", () => closed = true)
    .on("end", () => {
      if (!closed) {
        computeDiff(Buffer.concat(bufs), source, port, filePath);
      }
    });

  return () => {
    closed = true;
    fileReader.close(); // This may not close the stream.
    // Artificially marking end-of-stream, as if the underlying resource had
    // indicated end-of-file by itself, allows the stream to close.
    // This does not cancel pending read operations, and if there is such an
    // operation, the process may still not be able to exit successfully
    // until it finishes.
    fileReader.push(null);
    fileReader.read(0);
  };
}

function watchFileChanges(filePath: string, port: number): [IComputedValue<CatalogEntity[]>, Disposer] {
  const watcher = watch(filePath, {
    followSymlinks: false,
    disableGlobbing: true,
    alwaysStat: false,
    ignoreInitial: false,
  });
  const source = observable.map<string, RootSourceValue>();
  const derivedSource = computed(() => Array.from(source.values(), v => v[1]));
  let stopPrevious: Disposer | undefined = undefined;

  watcher
    .on("change", () => {
      stopPrevious?.();
      stopPrevious = diffChangedConfig(filePath, source, port);
    })
    .on("add", () => {
      stopPrevious?.();
      stopPrevious = diffChangedConfig(filePath, source, port);
    })
    .on("unlink", () => {
      stopPrevious?.();
    });

  return [derivedSource, () => watcher.close()];
}
