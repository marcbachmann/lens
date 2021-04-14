import { action, comparer, observable, toJS } from "mobx";
import { BaseStore } from "./base-store";

export interface KubeconfigSyncModel {
  files?: string[];
}

export class KubeconfigSyncStore extends BaseStore<KubeconfigSyncModel> {
  files = observable.set<string>();

  protected constructor() {
    super({
      configName: "lens-kubeconfig-sync-store",
      accessPropertiesByDotNotation: false,
      syncOptions: {
        equals: comparer.structural,
      },
    });
  }

  @action
  addSyncingFile(file: string): void {
    this.files.add(file);
  }

  @action
  removeSyncingFile(file: string): void {
    this.files.delete(file);
  }

  @action
  protected fromStore({ files = [] }: KubeconfigSyncModel = {}): void {
    this.files.replace(files);
  }

  toJSON(): KubeconfigSyncModel {
    return toJS({
      files: Array.from(this.files.values()),
    }, {
      recurseEverything: true,
    });
  }
}

export const kubeconfigSyncStore = KubeconfigSyncStore.getInstance<KubeconfigSyncStore>();
