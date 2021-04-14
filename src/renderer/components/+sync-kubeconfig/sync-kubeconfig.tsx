import "./sync-kubeconfig.scss";
import React from "react";
import { DropFileInput } from "../input";
import { PageLayout } from "../layout/page-layout";
import { Icon } from "../icon";
import { remote } from "electron";
import { kubeconfigSyncStore } from "../../../common/kubeconfig-sync-store";

export class SyncKubeconfig extends React.Component {
  kubeConfigPath: string;

  addSyncFile(file: File | string): void {
    if (typeof file === "string") {
      kubeconfigSyncStore.addSyncingFile(file);
    } else {
      kubeconfigSyncStore.addSyncingFile(file.path);
    }
  }

  syncManyFiles = (files: (File | string)[]): void => {
    for (const file of files) {
      this.addSyncFile(file);
    }
  };

  selectKubeConfigDialog = async () => {
    const { dialog, BrowserWindow } = remote;
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
      defaultPath: this.kubeConfigPath,
      properties: ["openFile", "showHiddenFiles"],
      message: "Select kubeconfig file(s)",
      buttonLabel: "Sync",
    });

    if (!canceled) {
      this.syncManyFiles(filePaths);
    }
  };

  render() {
    return (
      <DropFileInput onDropFiles={this.syncManyFiles}>
        <PageLayout className="SyncKubeconfig">
          <h2>Sync Kubeconfig files</h2>
          <p>
            Lens will sync the changes to configs.
            Allowing other programs to change them on the fly.
            Lens will ignore clusters that is cannot connect to.
          </p>
          <div className="kube-config-select flex gaps align-center">
            <Icon
              material="folder"
              onClick={this.selectKubeConfigDialog}
              tooltip="Browse"
            />
          </div>
          <small className="hint">
              Pro-Tip: you can also drag-n-drop kubeconfig file to this area
          </small>
        </PageLayout>
      </DropFileInput>
    );
  }
}
