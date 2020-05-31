import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension mediawiki-editor active.');

	let disposable = vscode.commands.registerCommand('mediawiki-editor.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from MediaWiki Editor!');
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {
	console.log('Extension mediawiki-editor deactivated.');
}
