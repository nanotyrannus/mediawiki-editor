import * as vscode from 'vscode';
import { MWClient } from './mwclient';

export class UploadDialog {

    private disposed: boolean;
    private panel: vscode.WebviewPanel;
    private static instance: UploadDialog;

    private constructor() {
        this.panel = this.WebviewPanelFactory();
        this.disposed = false;
    }

    private WebviewPanelFactory(): vscode.WebviewPanel {
        let panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true });
        panel.webview.html = `
        <!DOCTYPE html>
        <body style="height: 100%; width: 100%; background-color: pink;"></body>
        </html>`;  //Needed for fade-in effect to work.
        panel.onDidDispose(_ => {
            console.log("WebviewPanel Disposed.");
            this.disposed = true;
        });
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
            }
        });
        return panel;
    }

    public static getInstance(): UploadDialog {
        if (!this.instance) {
            this.instance = new UploadDialog();
        }
        if (UploadDialog.instance.disposed) {
            UploadDialog.instance.panel = UploadDialog.instance.WebviewPanelFactory();
            UploadDialog.instance.disposed = false;
        }
        return this.instance;
    }

    public static show(): void {
        UploadDialog.instance.panel.reveal(vscode.ViewColumn.Two);
    }
}