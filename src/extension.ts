import * as vscode from 'vscode';
import { MWClient, FetchPageFormat } from './mwclient';
import path = require('path');
import { existsSync, mkdirSync } from 'fs';
import { Preview } from './preview';
import { parse } from 'path';

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
	const selectedItem = articlePicker.selectedItems[0];
	const itemName = selectedItem.label;
	let response = await vscode.window.withProgress({
		"location": vscode.ProgressLocation.Window,
		"cancellable": false,
		"title": `Fetching ${itemName}`
	}, async () => {
		return MWClient.getRevisionAsync(itemName);
	});
	let pageIds = Object.getOwnPropertyNames(response.query.pages);
	let revisions = pageIds.map(id => {
		return {
			"user": response.query.pages[id].revisions[0].user,
			"content": response.query.pages[id].revisions[0].slots.main["*"]
		};
	});
	for (let revision of revisions) {
		openEditor(itemName, revision.content);
	}
	articlePicker.hide();
});

enum Overwrite {
	YES = "Yes, overwrite",
	NO = "No, keep current file"
}

async function openEditor(wikiPageTitle: string, content: string) {
	let filename = path.join(SAVE_ROOT.fsPath, wikiPageTitle + ".wiki");
	let fileExists = existsSync(filename);
	let overwrite = Overwrite.NO;
	if (fileExists) {
		overwrite = <Overwrite>(await vscode.window.showInformationMessage(`File ${wikiPageTitle}.wiki already exists on disk. Overwrite?`, Overwrite.YES, Overwrite.NO) ?? Overwrite.NO);
	}
	let scheme = fileExists ? "file:" : "untitled:";
	let file = vscode.Uri.parse(scheme + filename);
	let document = await vscode.workspace.openTextDocument(file);
	let edit = new vscode.WorkspaceEdit();
	if (document.getText() === "" || overwrite === Overwrite.YES) {
		let range = new vscode.Range(document.lineAt(0).range.start, document.lineAt(document.lineCount - 1).range.end);
		edit.replace(file, range, content);
		// edit.insert(file, new vscode.Position(0, 0), content);
	}
	return vscode.workspace.applyEdit(edit).then(success => {
		if (success) {
			vscode.window.showTextDocument(document, vscode.ViewColumn.One);
		} else {
			vscode.window.showInformationMessage("Failed to show document.");
		}
	});
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension mediawiki-editor active.');
	let workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	SAVE_ROOT = workspaceFolder?.uri ?? vscode.Uri.parse(context.globalStoragePath);
	if (!workspaceFolder) {
		vscode.window.showWarningMessage(`Workspace not found. Will place .wiki files in ${SAVE_ROOT.fsPath}`);
	}
	Preview.onOpenEditor(async (event) => {
		let response = await MWClient.fetchPageContentsAsync(event.title, FetchPageFormat.wikitext, event.section);
		let title = event.title;
		if (event.section !== undefined) {
			title = `${title}_section_${event.section}`;
		}
		openEditor(title, response.parse.wikitext["*"]);
	});
	Preview.onLinkNew(async (page) => {
		let answer = await vscode.window.showInformationMessage("Page does not yet exist. Open blank editor?", "Yes", "No");
		if (answer === "No") {
			return;
		} else {
			openEditor(page, "");
		}
	});
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
				await vscode.window.showInputBox({ prompt: "Username", ignoreFocusOut: true }) || "",
				await vscode.window.showInputBox({ prompt: "Password", ignoreFocusOut: true, password: true }) || ""
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
				let summary = await vscode.window.showInputBox({placeHolder: "Edit Summary (Esc to cancel, Enter to submit no summary)",ignoreFocusOut: true});
				if (summary === undefined) {
					return;
				}

				if (path.basename(articlePath, ".wiki").search(/section_[0-9]+$/) > 0) {
					// Commit specific section.

				}

				let file = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(SAVE_ROOT, articlePath));
				let result = await MWClient.commitEditsAsync(path.basename(articlePath, ".wiki"), file.toString(), false, summary);
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
				console.warn("articlePath falsy: ", articlePath);
			}
		} catch (e) {
			vscode.window.showErrorMessage(`${e.name}: ${e.message}`);
		}
	});

	let commitEditsMinorCommand = vscode.commands.registerCommand('mediawiki-editor.commitEditsMinor', async () => {
		console.log(`Commit Edits (Minor)`);
		let articlePath = await vscode.window.showQuickPick(vscode.workspace.textDocuments.map(docs => path.basename(docs.fileName)));
		if (articlePath) {
			let file = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(SAVE_ROOT, articlePath));
			let result = await MWClient.commitEditsAsync(path.basename(articlePath, ".wiki"), file.toString(), true);
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
			console.warn("articlePath falsy: ", articlePath);
		}
	});

	const provider = new RevisionProvider();

	vscode.window.registerTreeDataProvider(
		'revisionExplorer',
		provider
	);
	vscode.commands.registerCommand("mediawiki-editor.refreshEntry", () => {
		provider.refresh();
	});

	vscode.commands.registerCommand('revisionExplorer.getRevisions', (title: string) => {
		console.warn("NOT IMPLEMENTED");
	});

	context.subscriptions.push(findArticle, loginCommand, commitEditsCommand, commitEditsMinorCommand);

	vscode.workspace.onWillSaveTextDocument(async event => {
		console.log("Document save event");
		if (!Preview.getInstance().isEmpty()) {
			Preview.getInstance().fadeOut();
		}
		let articleTitle = path.basename(event.document.fileName, ".wiki");
		Preview.getInstance().setPanelTitle("Previewing: " + articleTitle);
		let parsedTextResponse = await vscode.window.withProgress({
			"cancellable": false,
			"location": vscode.ProgressLocation.Window,
			"title": `Loading preview for ${path.basename(event.document.fileName)}`
		}, _ => {
			return MWClient.getParsedWikiText(event.document.getText());
		});
		Preview.getInstance().setWikiHtml(parsedTextResponse.parse.text["*"]);
		Preview.getInstance().setArticleTitle(articleTitle);
		Preview.getInstance().finalize();
		Preview.show();
	});
}

export function deactivate() {
	console.log('Extension mediawiki-editor deactivated.');
}

export class RevisionProvider implements vscode.TreeDataProvider<Revision> {

	private pages = new Map<string, Array<any>>();

	async getTreeItem(element: Revision): Promise<vscode.TreeItem> {
		return Promise.resolve(element);
	}

	async getChildren(element?: Revision): Promise<Revision[]> {
		if (element) {
			if (!element.isPage) {
				let a = this.pages.get(element.label);
				return Promise.resolve([]);
			}
			return Promise.resolve([new Revision("revision", vscode.TreeItemCollapsibleState.None, false),]);
		} else {
			// let revisionsMap = vscode.workspace.textDocuments.map(document => {
			// 	if (document.fileName.indexOf(".wiki") < 0)  {
			// 		return new Revision(document.fileName, vscode.TreeItemCollapsibleState.Collapsed);
			// 	}
			// 	return null;
			// });
			let a = new Set();
			let articles = vscode.workspace.textDocuments
				.filter(document => document.fileName.indexOf(".wiki") >= 0)
				.map(document => path.basename(document.fileName, ".wiki"));
			// Gather all new documents
			let newArticles = articles.filter(articleName => !this.pages.has(articleName));
			console.log(`${newArticles.length} new articles`, newArticles);
			// Get 3 revisions of all new documents
			let responses = await Promise.all(newArticles.map(article => MWClient.getRevisionAsync(article, 3)));
			let revisions = new Array<Revision>();
			for (let response of responses) {
				for (let pageId in response.query.pages) {
					let page = response.query.pages[pageId];
					// Add new documents to `pages` cache
					this.pages.set(page.title, page.revisions);
					return Promise.resolve([new Revision(page.title, vscode.TreeItemCollapsibleState.Expanded, true)]);
				}
			}

			return Promise.resolve([]);
			// let revisions = articles.map(doc => {
			// 	return new Revision(path.basename(doc.fileName,".wiki"), vscode.TreeItemCollapsibleState.Collapsed, true);
			// });
		}
	}

	private _onDidChangeTreeData: vscode.EventEmitter<Revision | undefined> = new vscode.EventEmitter<Revision | undefined>();
	readonly onDidChangeTreeData: vscode.Event<Revision | undefined> = this._onDidChangeTreeData.event;

	refresh(changedElement?: Revision): void {
		this._onDidChangeTreeData.fire(changedElement);
	}
}



class Revision extends vscode.TreeItem {

	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly isPage: boolean,
		public description?: string,
		// public readonly pageId?: number,
		// public readonly revId?: number
	) {
		super(label, collapsibleState);
		if (isPage) {
			this.iconPath = {
				light: path.join(__filename, '..', '..', "media", "file.svg"),
				dark: path.join(__filename, '..', '..', "media", "file_dark.svg")
			};
		} else {
			this.iconPath = {
				light: path.join(__filename, '..', '..', "media", "go-to-file.svg"),
				dark: path.join(__filename, '..', '..', "media", "go-to-file_dark.svg")
			};
		}
	}

	get tooltip(): string {
		return "";
	}

	// get description(): string {
	// 	// Should this be creation timestamp?
	// 	return `Description`;
	// }
}

vscode.window.onDidChangeActiveTextEditor(async () => {
	// On activation, build state including
	// revisions on all known documents that are wiki articles
	console.log("Changed active text editor!");
	vscode.commands.executeCommand("mediawiki-editor.refreshEntry");
});