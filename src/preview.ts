import * as vscode from 'vscode';
import { MWClient, FetchPageFormat } from './mwclient';

const WIKI_URL = vscode.workspace.getConfiguration("mediawiki-editor").get("wikiUrl");

export class Preview {
    private static instance: Preview;
    private html = "";
    private style = "";
    public disposed: boolean;
    private panel: vscode.WebviewPanel;
    private articleTitle: string;
    private static _onOpenEditor = new vscode.EventEmitter<{title:string, section?: number}>();
    private static _onLinkNew = new vscode.EventEmitter<string>();
    public static readonly onOpenEditor = Preview._onOpenEditor.event;
    public static readonly onLinkNew = Preview._onLinkNew.event;

    private constructor() {
        this.panel = this.WebviewPanelFactory();
        this.disposed = false;
        this.articleTitle = "";
    }

    private static async navigateTo(page: string) {
        let instance = Preview.getInstance();
        instance.fadeOut();
        // let html = await MWClient.getRevisionAsync(page);
        // let pageId = Object.getOwnPropertyNames(html.query.pages)[0];
        // instance.setWikiHtml(html.query.pages[pageId].revisions[0].slots["main"]["*"]);
        // instance.finalize();
        let html = await MWClient.fetchPageContentsAsync(page, FetchPageFormat.html);
        instance.setWikiHtml(html.parse.text["*"]);
        instance.setArticleTitle(page);
        instance.finalize();
        instance.panel.webview.postMessage({ command: 'show-edit-btn', data: page });
    }

    private WebviewPanelFactory(): vscode.WebviewPanel {
        let panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true });
        panel.webview.html = "<!DOCTYPE html></html>";  //Needed for fade-in effect to work.
        panel.onDidDispose(_ => {
            console.log("WebviewPanel Disposed.");
            this.disposed = true;
            this.articleTitle = "";
        });
        panel.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'edit': // Opens section in editor.
                    if (!this.articleTitle) {
                        vscode.window.showWarningMessage(`articleTitle not set.`);
                    } else {
                        // vscode.window.showInformationMessage("edit: " + message.data.match(/section=([0-9]+)/)?.[1] ?? `Didn't match: ${message.data}`);
                        let section = message.data.match(/section=([0-9]+)/)?.[1];
                        // let sectionContent = await MWClient.fetchPageContentsAsync(this.articleTitle, FetchPageFormat.wikitext);
                        Preview._onOpenEditor.fire({title: this.articleTitle, section: section});
                    }
                    break;
                case 'link': // Opens preview in detached mode.
                    vscode.window.showInformationMessage("link: " + message.data);
                    // This only accounts for /wiki/ style URLs. Should also implement
                    // support for parameter style URLs.
                    let title = message.data.match(/.*\/(.*)$/)[1];
                    Preview.navigateTo(title);
                    break;
                case 'link-new': // Ask if user wants to create page.
                    let href = <string>message.data;
                    if (href.indexOf("redlink") > 0) {
                        let page = href.match(/title=([_a-zA-Z]+)/)?.[1] ?? "";
                        if (page) {
                            Preview._onLinkNew.fire(page);
                        } else {
                            vscode.window.showErrorMessage("Something went wrong: link-new falsy.");
                        }
                    } else {
                        Preview._onLinkNew.fire(message.data);
                    }
                    break;
                case 'open-editor':
                    console.log(`OPEN EDITOR:`, message);
                    Preview._onOpenEditor.fire({title: message.data});
                    break;
                default: vscode.window.showWarningMessage(`Unknown command: ${message.command}`);
            }
        });
        return panel;
    }

    public static getInstance(): Preview {
        if (!this.instance) {
            this.instance = new Preview();
        }
        if (Preview.instance.disposed) {
            Preview.instance.panel = Preview.instance.WebviewPanelFactory();
            Preview.instance.disposed = false;
        }
        return this.instance;
    }

    public setArticleTitle(title: string) {
        this.articleTitle = title;
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
        const vscode = acquireVsCodeApi();
        function onclickHandlerFactory(callback) {
            return function onclickHandler(e) {
                e.preventDefault();
                e.stopPropagation();
                callback();
                return false;
            };
        };
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'fade':
                    document.querySelector('body').style.opacity = 0;
                    break;
                case 'show-edit-btn':
                    let editButton = document.querySelector('.edit-btn');
                    editButton.style.display = "initial";
                    editButton.onclick = onclickHandlerFactory(() => {
                        vscode.postMessage({
                            command: "open-editor",
                            data: message.data
                        });
                    });
                    break;
                default:
                    console.error(\`Unsupported command: \${message.data}\`);
            }
        });
        </script>
        <style>${this.style}</style>
        <style>
        body {
            opacity: 0; 
            transition-property: opacity; 
            transition-duration: 0.5s;
        }
        .new {
            color: red;
        }
        .edit-btn {
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: white;
            padding: 7px;
            opacity: 0.7;
            transition-property: opacity;
            transition-duration: 0.3s;
        }
        .edit-btn:hover {
            opacity: 1;
        }
        a.external {
            text-decoration: underline dotted;
        }
        </style>
			<base href="${WIKI_URL}"></base>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
		</head>
        <body>
        <div class="edit-btn" style="display:none"><a href="#">Open in Editor</a></div>
        ${this.html}
        </body>
        <script>
        let body = document.querySelector('body');
        body.onload = () => {
            body.style.opacity = 1;
            document.querySelectorAll('a[title^=Edit]').forEach(el => {
                el.onclick = onclickHandlerFactory(() => {
                    vscode.postMessage({
                        command: 'edit',
                        data: el.href
                    });
                });
            });
            document.querySelectorAll('a[href^="/wiki/"]').forEach(el => {
                el.onclick = onclickHandlerFactory(() => {
                    vscode.postMessage({
                        command: 'link',
                        data: el.href
                    });
                });
            });
            document.querySelectorAll('a.new').forEach(el => {
                el.onclick = onclickHandlerFactory(() => {
                    vscode.postMessage({
                        command: 'link-new',
                        data: el.href
                    });
                });
            });
        };
        </script>
        </html>`;
    }

    public fadeOut(): void {
        this.panel.webview.postMessage({ command: 'fade' });
    }

    public isEmpty(): boolean {
        return !Boolean(this.panel.webview.html);
    }

    // should rendering and "showing" be the same function?
    // maybe not because you may want to render more than once without disposing
}
