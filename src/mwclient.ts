import * as vscode from 'vscode';
import * as FormData from 'form-data';
import * as NodeFetch from 'node-fetch';
import * as path from 'path';
import { CookieJar } from 'tough-cookie';
let jar = new CookieJar();
let fetchCookie = require('fetch-cookie');
let fetch = require('fetch-cookie')(NodeFetch, jar);

let CONFIG = vscode.workspace.getConfiguration("mediawiki-editor");
let WIKI_URL = CONFIG.get("wikiUrl");
let AS_BOT = CONFIG.get("asBot");
let OVERRIDE_EDIT_PREF = CONFIG.get("overrideEditPref");

vscode.workspace.onDidChangeConfiguration(event => {
    CONFIG = vscode.workspace.getConfiguration('mediawiki-editor');
    if (event.affectsConfiguration('mediawiki-editor.asBot')) {
        AS_BOT = CONFIG.get("asBot");
        // vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else if (event.affectsConfiguration('mediawiki-editor.wikiUrl')) {
        WIKI_URL = CONFIG.get('wikiUrl');
    } else if (event.affectsConfiguration('mediawiki-editor.overrideEditPref')) {
        OVERRIDE_EDIT_PREF = CONFIG.get("overrideEditPref");
    }
});

if (!WIKI_URL) {
    vscode.window.showErrorMessage("Wiki Url not set. This is needed to connect to the MediaWiki instance.", "OK", "Take me to the setting.").then(value => {
        if (value === "Take me to the setting.") {
            vscode.commands.executeCommand( 'workbench.action.openSettings', 'mediawiki-editor.wikiUrl');
        }
    });
}

/**
 * @summary If `FetchPageFormat` is `text`, read `text` property.
 * Likewise, if `FetchPageFormat` is `wikitext`, read `wikitext` property.
 */
interface FetchPageResponse {
    parse: {
        title: string,
        pageid: number,
        text: {
            "*" : string
        },
        wikitext: {
            "*" : string
        }
    }
}

interface PSResult {
    query?: {
        prefixsearch: Array<PSResultItem>
    }
}

interface PSResultItem {
    ns: number
    title: string
    pageid: number
}

interface RVResult {
    /**
     * @property {curtimestamp} ISO date string.
     * @property {continue} Present if there are additional pages.
     * @property {rvcontinue} Token whose value must be included in rvcontinue
     * value in the next request to get the following page.
     */
    query: {
        pages: {
            [pageId: string]: RVPage
        }
    },
    curtimestamp: string,
    continue?: {
        rvcontinue: string
        continue: string
    }
}

interface RVPage {
    /**
     * @property {pageid} The unique ID of a wiki article.
     * @property {title} The unique title of a wiki article.
     * @property {revisions} An array of revision items belonging to an article.
     * @property {ns} TODO still don't know what the heck this is.
     */
    pageid: number
    ns: number
    title: string
    revisions: Array<RVRevision>
}

interface RVRevision {
    /**
     * @property {revid} The unique ID of a revision of a wiki article. 
     * @property {parentid} The ID of a revision that directly preceeds this revision.
     * @property {user} The username of the author of this revision.
     * @property {timestamp} The timestamp of when this revision was submitted.
     * @property {tags} TODO
     * @property {slots} TODO
     */
    revid: number
    parentid: number
    user: string
    timestamp: string
    slots: any
    tags: string[]
}

interface TokenResult {
	/***
	 * @property {query} Result body.
	 * @property {tokens} A map of the requested tokens.
	 * @property {logintoken} A token needed to use the login API.
     * @property {csrftoken} A token needed to edit pages.
	 */
	query: {
		tokens: {
			logintoken: string,
			watchtoken?: string,
			patroltoken?: string,
			userrightstoken?: string,
			createaccounttoken?: string,
			deleteglobalaccounttoken?: string,
			rollbacktoken?: string,
			setglobalaccountstatustoken?: string,
			csrftoken?: string
		}
	}
}

interface LoginResult {
    /**
     * @property {status} Either PASS or FAIL
     * @property {message} Error message from the server.
     * @property {messagecode} Accompanies {message}, describes type of error.
     * @property {username} On PASS, will return name of username.
     */
	clientlogin: {
		status: string,
		message?: string,
		messagecode?: string,
		username?: string
	}
}

interface EditResult {
    /**
     * @property {title} Title of article.
     * @property {pageid} ID of article.
     * @property {contentmodel} Format of wiki content in response body. Set to "wikitext".
     * @property {result} "Success" or "Failure"
     * @property {oldrevid} Old revision ID
     * @property {newrevid} New revision ID of submitted edit.
     * @property {newtimestamp} An ISO datetime string.
     */
    edit: {
        result: string,
        pageid: number,
        title: string,
        contentmodel: string,
        oldrevid: number,
        newrevid: number,
        newtimestamp: string 
    }
}

enum TokenType {
    CREATE_ACCOUNT = "createaccount",
    CSRF = "csrf",
    DELETE_GLOBAL_ACCOUNT = "deleteglobalaccount",
    LOGIN = "login",
    PATROL = "patrol",
    ROLLBACK = "rollback",
    SET_GLOBAL_ACCOUNT_STATUS = "setglobalaccountstatus",
    USER_RIGHTS = "userrights",
    WATCH = "watch"
}

interface ParsedResponse {
    timestamp: string,
    parse: {
        text: {
            "*" : string
        },
        categories: Array<{
            "*" : string,
            missing: string,
            sortkey: string
        }>
    }
}

export class MWClient {

    private static context: vscode.ExtensionContext;
    

    public static async initializeAsync(context: vscode.ExtensionContext) {
        MWClient.context = context;
        let cookie;
        // If cookie exists, load this into fetch;
        if (cookie = context.globalState.get('cookie')) {
            console.log(`Loading cookie`, cookie);
            jar = CookieJar.deserializeSync(<string>cookie);   
            fetch = fetchCookie(NodeFetch, jar);
        } else {
            console.log(`No cookie found`, cookie);
        }
    }

    /**
     * @summary Search wiki articles by prefix. Does not search through
     * article content other than the title.
     */

    public static async prefixSearchAsync(query: string): Promise<PSResult> {
            let form = new FormData();
            form.append('action', 'query');
            form.append('list', 'prefixsearch');
            form.append('pssearch', query);
            form.append('psprofile', 'fuzzy');
            form.append('format', 'json');
    
            let result = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            });
            await toJson(result);
            return result;
    }

    public static getCsrfToken(): Promise<TokenResult> {
        return this.getTokenAsync(TokenType.CSRF);
    }

    private static async getTokenAsync(token: TokenType): Promise<TokenResult> {
        return new Promise(async (resolve, reject) => {
            let form = new FormData();
            form.append('action', 'query');
            form.append('meta', 'tokens');
            form.append('type', token);
            form.append('format', 'json');
            let response = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            })
            .then(statusCheck)
            .then(logMessage(`FROM getTokenAsync: ${token}`))
            .then(toJson);
            resolve(response);
        });
    }

    public static async getResourcesPromise(): Promise<string> {
        return new Promise(async (resolve, reject) => {
            let form = new FormData();
            form.append("debug", "false");
            form.append("lang", "eng");
            form.append("modules", ["ext.cite.styles","mediawiki.legacy.commonPrint,shared","mediawiki.skinning.content.externallinks","mediawiki.toc.styles"].join("|"));
            form.append("only", "styles");
            form.append("skin", "timeless");
            let response = await fetch(`${WIKI_URL}/load.php`, {
                method: 'POST',
                body: form
            })
            .then(statusCheck)
            .then((res: any) => res.text());
            resolve(response);
        });
    }

    public static async getParsedWikiText(text: string): Promise<ParsedResponse> {
            let form = new FormData();
            form.append('action', 'parse');
            form.append('format', 'json');
            form.append('text', text);
            form.append('contentmodel','wikitext');
            form.append('curtimestamp', 'true');

            try {
                var response = await fetch(`${WIKI_URL}/api.php`, {
                    method: 'POST',
                    body: form
                })
                .then(statusCheck)
                .then(toJson);
            } catch (e) {
                throw Promise.reject(e);
            }

            return response;
    }

    /**
     * @summary Saves page content, creating a new revision.
     * @param title 
     * @param text 
     */
    public static async commitEditsAsync(title: string, text: string, minor: boolean, summary?: string): Promise<EditResult> {
        return new Promise(async (resolve, reject) => {
            let token = await this.getTokenAsync(TokenType.CSRF);
            if (token.query.tokens.csrftoken === '+\\') {
                console.log("rejected");
                return reject(new Error("Could not edit page. Token returned empty. Are you logged in?"));
            }
            let form = new FormData();
            form.append('action', 'edit');
            form.append('title', title);
            if (minor) {
                form.append('minor', '');
            } else if (OVERRIDE_EDIT_PREF && !minor) {
                form.append('notminor', '');
            }
            if (summary !== undefined) {
                form.append('summary', summary);
            }
            form.append('bot', String(AS_BOT));
            // form.append('createonly', true);
            form.append('format', 'json');
            form.append('text', text);
            form.append('token', token.query.tokens.csrftoken); // Token should always be last, or at least after the text parameter.
    
            let response = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            })
            .then(statusCheck)
            .then(toJson)
            .then(logMessage(`commitEdits with token ${token.query.tokens.csrftoken}`))
            .then(MWClient.saveCookie);
            resolve(response);
        });
    }

    /**
     * @summary Logs into wiki with provided credentials. No state is returned
     * in the body, rather the library keeps a cookie session. This may change
     * in the future to a more transparent/programmatic strategy.
     */
    public static async loginAsync(username: string, password: string): Promise<LoginResult> {
        let tokenResult = await this.getTokenAsync(TokenType.LOGIN);
        if (tokenResult.query.tokens.logintoken === "+\\") {
            throw new Error("Empty login token.");
        }
        let form = new FormData();
        form.append('action', 'clientlogin');
        form.append('loginreturnurl', `${WIKI_URL}`);
        form.append('logintoken', tokenResult.query.tokens.logintoken);
        form.append('username', username);
        form.append('password', password);
        form.append('format', 'json');

        let response = await fetch(`${WIKI_URL}/api.php`, {
            method: 'POST',
            body: form
        })
        .then(statusCheck)
        .then(toJson)
        .then(logIt);
        
        return response;
    }

    /**
     * Get a revision by ID.
     * @param {id} An ID of a specific revision.
     * @param {next} A continuation token from a previous request. If 
     * supplied, the next page will be returned.
     */
    public static async getRevisionAsync(id: number, numberOfRevisions?: number, next?: string): Promise<RVResult>;
    /**
     * Get the latest revision of an article by its title.
     * @param {title} The title of an article.
     * @param {next} A continuation token from a previous request. If 
     * supplied, the next page will be returned.
     */
    public static async getRevisionAsync(title: string, numberOfRevisions?: number, next?: string): Promise<RVResult>;
    public static async getRevisionAsync(id: string | number, numberOfRevisions?: number, next?: string): Promise<RVResult> {
        return new Promise<RVResult>(async (resolve, reject) => {
            let form = new FormData();
            form.append("action", "query");
            form.append("prop", "revisions");
            form.append("format", "json");
            form.append("rvprop", "content|user|timestamp");
            form.append("rvslots", "main");
            form.append("curtimestamp", "true");
            form.append("errorformat", "wikitext");
            if (typeof id === "string") {
                console.log("id is STRING");
                form.append('titles', id);
            } else if (typeof id === "number") {
                form.append('revids', String(id));
            }

            if (numberOfRevisions) {
                form.append("rvlimit", String(numberOfRevisions));
            }

            if (next) {
                form.append('rvcontinue', next);
            }

            let response = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            })
            .then(toJson)
            .then(logIt);
            resolve(response);
        });
    }

    // Helper function. Consider moving to own class if there are many more.
    public static async getLatestRevisionAsync(pageTitle: string) {
        let response = await this.getRevisionAsync(pageTitle);
        let pageIds = Object.getOwnPropertyNames(response.query.pages);
        let revisions = pageIds.map(id => {
            return {
                "user": response.query.pages[id].revisions[0].user,
                "content": response.query.pages[id].revisions[0].slots.main["*"]
            };
        });
        return revisions[0];
    }

    public static async uploadFileAsync(filename: string, file: any, text?: string) {
        let form = new FormData();
        let token = await this.getTokenAsync(TokenType.CSRF);
        form.append('action', 'upload');
        form.append('file', file);
        form.append('filesize', 0);
        form.append('token', token);
        
        if (text) {
            form.append('text', text);
        }

        let response = await fetch(`${WIKI_URL}/api.php`, {
            method: 'POST',
            body: form
        })
        .then(toJson);

        return response;
    }

    public static async fetchPageContentsAsync(page: string, responseFormat: FetchPageFormat, section?: number) {
            let form = new FormData();
            form.append("action", "parse");
            form.append("prop", responseFormat);
            form.append("page", page);

            if (section !== undefined) {
                form.append('section', String(section));
            }

            form.append("format", "json");
            form.append("curtimestamp", "true");

            try {
                var response = await fetch(`${WIKI_URL}/api.php`, {
                    method: 'POST',
                    body: form
                }).then(toJson);
            } catch (e) {
                throw Promise.reject(e);
            }

            return response;
    }

    private static async saveCookie(result: any){
        // console.log(`Saving cookie state to persistent memory.`);
        console.log(`Cookies:`, jar.serializeSync());
        // await MWClient.context.globalState.update('cookie', jar.serializeSync());
        // console.log(`Saved cookie:`, await MWClient.context.globalState.get('cookie'));
        return Promise.resolve(result);
    }
}

export enum FetchPageFormat {
    wikitext = "wikitext",
    html = "text"
}

// function saveCookie(result: any) {
//     console.log(`Saving cookie to persistent memory.`);
    
//     return Promise.resolve(result);
// } 

async function logIt(result: any) {
    console.log(result);
    return Promise.resolve(result);
}
function toJson(result: NodeFetch.Response) {
    return Promise.resolve(result.json());
}
function statusCheck(result: NodeFetch.Response) {
    if (result.ok) {
        console.log(`STATUS OK: ${result.status}`);
        return Promise.resolve(result);
    } else {
        console.log(`STATUS: ${result.status}`);
        return Promise.reject(result);
    }
}

function logMessage(message: string) {
    return (result: any) => {
        console.log(`${message}`);
        return Promise.resolve(result);
    };
}