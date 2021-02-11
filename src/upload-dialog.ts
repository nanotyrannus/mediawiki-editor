import * as vscode from 'vscode';
import { MWClient } from './mwclient';
import * as path from 'path';

export class UploadDialog {

    private disposed: boolean;
    private panel: vscode.WebviewPanel;
    private static instance: UploadDialog;
    private static wikiUrl = vscode.workspace.getConfiguration("mediawiki-editor").get('wikiUrl');

    public static resourcePath: vscode.Uri;

    public static setResourcePath(s: vscode.Uri) {
        UploadDialog.resourcePath = s;
    }

    private constructor() {
        this.panel = this.WebviewPanelFactory();
        this.disposed = false;
    }

    private WebviewPanelFactory(): vscode.WebviewPanel {
        let panel = vscode.window.createWebviewPanel("mediawiki-editor", "Article Preview", vscode.ViewColumn.Two, { enableScripts: true , localResourceRoots: [UploadDialog.resourcePath]});
        let scriptOnDisk = vscode.Uri.file(path.join(UploadDialog.resourcePath.path, 'mwclient.js'));
        let webviewScript = panel.webview.asWebviewUri(vscode.Uri.joinPath(UploadDialog.resourcePath, "mwclient.js"));
        console.log('webviewscript: ', webviewScript);
        panel.webview.html = `
        <!DOCTYPE html>
        <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src file: vscode-webview-resource: vscode-webview: 'unsafe-inline'; style-src 'unsafe-inline';"/>
            <style>
                body {
                    display: flex;
                    height: 100vh;
                    width: 100vw;
                    margin: 0;
                    justify-content: center;
                    align-items: center;
                    background-color: darkslategrey;
                }

                #drop-area {
                    background-color: rgb(70, 70, 70);
                    padding: 10px;
                    border-radius: 15px;
                    display: flex;
                    height: 15vh;
                    margin: 5px;
                    color: white;
                    transition-property: background-color, color;
                    transition-duration: 0.2s;
                }

                .item-hover {
                    background-color:rgb(235, 235, 235) !important;
                    border: 3px dashed rgb(32, 32, 32);
                    color: rgb(26, 26, 26) !important;
                }

                #drop-text {
                    align-self: center;
                }
            </style>
            <script src="${webviewScript}"></script>
        </head>
        <body>
        <div id="drop-area" ondrop="dropHandler(event);" ondragover="dragOverHandler(event);" ondragleave="dragLeaveHandler(event);" ondragend="dragLeaveHandler(event);">
            <p id="drop-text">Drop a file here to upload.</p>
        </div>
        </body>
        <script>
        const vscode = acquireVsCodeApi();
        const WIKI_URL = "${UploadDialog.wikiUrl}";
        let dropArea = document.querySelector('#drop-area');
        let dropText = document.querySelector('#drop-text');
        let token = '';

        let hoverClasses = ["item-hover"];

        function dragLeaveHandler(ev) {
            console.log("Drag ended");
            dropArea.classList.remove(...hoverClasses);
        }

        function dropHandler(ev) {
            ev.preventDefault();
            dropArea.classList.remove(...hoverClasses);
            console.log("Dropped!");

            if (ev.dataTransfer.items) {
                for (var i = 0; i < ev.dataTransfer.items.length; i++) {
                    if (ev.dataTransfer.items[i].kind === 'file') {
                        var file = ev.dataTransfer.items[i].getAsFile();
                        console.log('file', file);
                        vscode.postMessage({
                            'command' : 'token'
                        });
                        window.addEventListener('message', async event => {
                            let message = event.data;
                            console.log(message);
                            await uploadFileAsync(file, 'Test text', message.token);
                            console.log('Upload callback finished');
                        }, {once: true});
                    }
                }
            } else {
                console.warn('ev.dataTransfer.items not supported');
            }
        }

        async function uploadFileAsync(file, text, token) {
            let form = new FormData();
            form.append('action', 'upload');
            form.append('text', text);
            form.append('file', file);
            form.append('filesize', file.size);
            form.append('token', token);
            form.append('filename', 'Test Upload Name');

            let response = await fetch(\`\${WIKI_URL}api.php\`, {
                method: 'POST',
                body: form
            });
            return response;
        }

        function dragOverHandler(ev) {
            console.log(ev);
            ev.preventDefault();
            dropArea.classList.add(...hoverClasses);
            console.log("Dragover event!");
        }

        window.addEventListener('message', event => {
            const message = event.data;
            console.log('message:', message);
            switch (message.type) {
                case 'token':
                    token = message.token;
                break;
            }
        });
        </script>
        </html>`;  //Needed for fade-in effect to work.
        panel.onDidDispose(_ => {
            console.log("WebviewPanel Disposed.");
            this.disposed = true;
        });
        panel.webview.onDidReceiveMessage(async message => {
            console.log("Message received: ", message);
            switch (message.command) {
                case 'token':
                    let token = await MWClient.getCsrfToken();
                    panel.webview.postMessage({
                        'type' : 'token',
                        'token' : token["query"]["tokens"]["csrftoken"]
                    });
                break;
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