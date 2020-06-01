import * as vscode from 'vscode';
import { MWClient, TokenType } from './mwclient';
import path = require('path');
import { existsSync, mkdirSync } from 'fs';

let articlePicker = vscode.window.createQuickPick();
let SAVE_ROOT: vscode.Uri;

let debounceTimeoutId: NodeJS.Timeout;
const DEBOUNCE_THRESHOLD = 200;

function articlePickerDidChangeValueHandler(val: string) {
	if (!val) {
		return;
	}
	if (debounceTimeoutId) {
		clearTimeout(debounceTimeoutId);
	}
	debounceTimeoutId = setTimeout(async () => {
		let result = await MWClient.prefixSearchAsync(val);
		let resultMap = result.query?.prefixsearch.map(item => {
			return {
				label: item["title"]
			};
		});
		articlePicker.items = resultMap ?? [];
	}, DEBOUNCE_THRESHOLD);
}
articlePicker.onDidChangeValue(articlePickerDidChangeValueHandler);
articlePicker.onDidAccept(async () => {
	if (articlePicker.selectedItems.length === 0) {
		console.log("Article Picker: ", articlePicker.value);
		// TODO Prompt user to create new article.
		articlePicker.hide();
		let option = await vscode.window.showInformationMessage(`Would you like to create article ${articlePicker.value}?`, "Yes", "No");
		console.log(option);
		return;
	}
	let response = await vscode.window.withProgress({
		"location" : vscode.ProgressLocation.Window,
		"cancellable" : false,
		"title": `Fetching ${articlePicker.selectedItems[0].label}`
	}, async () => {
		return MWClient.getRevisionAsync(articlePicker.selectedItems[0].label);
	});
	let pageIds = Object.getOwnPropertyNames(response.query.pages);
	let revisions = pageIds.map(id => {
		return {
			"user": response.query.pages[id].revisions[0].user,
			"content": response.query.pages[id].revisions[0].slots.main["*"]
		};
	});
	for (let revision of revisions) {
		let filename = path.join(SAVE_ROOT.fsPath, articlePicker.selectedItems[0].label + ".wiki");
		let scheme = existsSync(filename) ? "file:" : "untitled:";
		// let option = await vscode.window.showInformationMessage(`${findArticlePicker.selectedItems[0].label} already exists. Overwrite local file?`, Overwrite.YES, Overwrite.NO);
		// if (option === Overwrite.YES) {

		// }
		let file = vscode.Uri.parse(scheme + filename);
		let document = await vscode.workspace.openTextDocument(file);
		// vscode.workspace.fs.stat(file).then(success => {
		// 	console.log("stat: ", success);
		// }, reject => {
		// 	console.error("stat error: ", reject);
		// });
		let edit = new vscode.WorkspaceEdit();
		if (document.getText() === "") {
			edit.insert(file, new vscode.Position(0, 0), revision.content);
		}
		return vscode.workspace.applyEdit(edit).then(success => {
			if (success) {
				vscode.window.showTextDocument(document);
			} else {
				vscode.window.showInformationMessage("Failed to show document.");
			}
		});
	}
	articlePicker.hide();
});

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension mediawiki-editor active.');
	SAVE_ROOT = vscode.Uri.parse(context.globalStoragePath);
	if (existsSync(SAVE_ROOT.fsPath)) { // Use this instead of /tmp because Windows not suprot /tmp
		console.log("globalStoragePath: ", SAVE_ROOT.fsPath);
	} else {
		console.log("globalStoragePath does not exist. Creating it at: ", SAVE_ROOT.fsPath);
		mkdirSync(SAVE_ROOT.fsPath);
	}

	let findArticle = vscode.commands.registerCommand('mediawiki-editor.findArticle', async () => {
		articlePicker.show();
	});

	let loginCommand = vscode.commands.registerCommand('mediawiki-editor.login', async () => {
		try {
			let loginResponse = await MWClient.loginAsync(
				await vscode.window.showInputBox({prompt: "Username", ignoreFocusOut: true}) || "",
				await vscode.window.showInputBox({prompt: "Password", ignoreFocusOut: true, password: true}) || ""
			);
			if (loginResponse.clientlogin.status === 'PASS') {
				vscode.window.showInformationMessage(`Successfully logged in as ${loginResponse.clientlogin.username}`);
			} else {
				vscode.window.showErrorMessage(`${loginResponse.clientlogin.status} (${loginResponse.clientlogin.messagecode}): ${loginResponse.clientlogin.message}`);
			}
		} catch (e) {
			vscode.window.showErrorMessage(e);
		}
	});

	let commitEditsCommand = vscode.commands.registerCommand('mediawiki-editor.commitEdits', async () => {
		console.log("commitEditsCommand");
		try {
			let articlePath = await vscode.window.showQuickPick(vscode.workspace.textDocuments.map(docs => path.basename(docs.fileName)));
			if (articlePath) {
				let file = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(SAVE_ROOT, articlePath));
				let result = await MWClient.commitEditsAsync(path.basename(articlePath, ".wiki"), file.toString());
				if (result.edit.result === 'Success') {
					if (result.hasOwnProperty("nochange")) {
						vscode.window.showInformationMessage(`Success. No change to ${result.edit.title}`);
					} else {
						vscode.window.showInformationMessage(`Success. Revision ${result.edit.newrevid} at ${result.edit.newtimestamp}`);
					}
				} else {
					vscode.window.showErrorMessage(`Error, edit to ${result.edit.title} not successful.`);
					console.log(result);
				}
			} else {
				console.log("articlePath falsy: ", articlePath);
			}
		} catch (e) {
			vscode.window.showErrorMessage(`${e.name}: ${e.message}`);
		}
	});

	context.subscriptions.push(findArticle,loginCommand);
}

export function deactivate() {
	console.log('Extension mediawiki-editor deactivated.');
}
