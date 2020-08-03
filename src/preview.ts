import * as vscode from 'vscode';

export class Preview {
    private static instance: Preview;
    private html = "";
    private style = "";
    private disposed: boolean;
    private panel: vscode.WebviewPanel;

    private constructor() {
        this.panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true });
        this.disposed = false;
        this.panel.onDidDispose(_ => {
            console.log("WebviewPanel Disposed");
            this.disposed = true;
        });
    }

    public static getInstance(): Preview {
        if (!this.instance) {
            this.instance = new Preview();
        }
        if (Preview.instance.disposed) {
            Preview.instance.panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true });
        }
        return this.instance;
    }

    public setPanelTitle(title: string): void {
        this.panel.title = title;
    }

    public static show(): void {
        Preview.instance.panel.reveal(vscode.ViewColumn.Two);
    }

    public setHtml(text: string) {
        this.html = text;
        this.panel.webview.html = text;
    }
}