import * as vscode from 'vscode';

export class Preview {
    private static instance: Preview;
    private html = "";
    private style = "";
    public disposed: boolean;
    private panel: vscode.WebviewPanel;

    private constructor() {
        this.panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true });
        this.panel.webview.html = "<DOCTYPE html><body></body></html>"; //Needed for fade-in effect to work.
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
            Preview.instance.panel.webview.html = "<DOCTYPE html><body></body></html>";
            Preview.instance.disposed = false;
            Preview.instance.panel.onDidDispose(_ => {
                console.log("WebviewPanel Disposed");
                Preview.instance.disposed = true;
            });
        }
        return this.instance;
    }

    public setPanelTitle(title: string): void {
        this.panel.title = title;
    }

    public static show(): void {
        Preview.instance.panel.reveal(vscode.ViewColumn.Two);
    }

    public setWikiHtml(text: string) {
        this.html = text;
    }

    public setStyle(text: string) {
        this.style = text;
    }

    public finalize(): void {
        this.panel.webview.html = `<!DOCTYPE html>
		<html lang="en">
        <head>
        <script>
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'fade':
                    document.querySelector('body').style.opacity = 0;
                    break;
            }
        });
        </script>
        <style>${this.style}</style>
        <style>body {opacity: 0; transition-property: opacity; transition-duration: 0.5s;} </style>
			<base href="https://wiki.rconstantino.com/"></base>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
        <body>${this.html}</body>
        <script>
        let body = document.querySelector('body');
        body.onload = () => {
            body.style.opacity = 1;
        };
        </script>
        </html>`;
    }

    public fadeOut(): void {
        this.panel.webview.postMessage({command: 'fade'});
    }

    public isEmpty(): boolean {
        return !Boolean(this.panel.webview.html);
    }

    // should rendering and "showing" be the same function?
    // maybe not because you may want to render more than once without disposing
}