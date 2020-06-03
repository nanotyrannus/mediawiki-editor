import * as vscode from 'vscode';
import * as FormData from 'form-data';
import * as NodeFetch from 'node-fetch';
const fetch = require('fetch-cookie')(NodeFetch);

const WIKI_URL = vscode.workspace.getConfiguration("mediawiki-editor").get("wikiUrl");
const AS_BOT = vscode.workspace.getConfiguration("mediawiki-editor").get("asBot");

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
        pages: any
    },
    curtimestamp: string,
    continue: {
        rvcontinue: string
        continue: string
    }
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

export class MWClient {

    /**
     * @summary Search wiki articles by prefix. Does not search through
     * article content other than the title.
     */
    public static async prefixSearchAsync(query: string): Promise<PSResult> {
        return new Promise<PSResult>(async (resolve, reject) => {
            let form = new FormData();
            form.append('action', 'query');
            form.append('list', 'prefixsearch');
            form.append('pssearch', query);
            form.append('psprofile', 'fuzzy');
            form.append('format', 'json');
    
            let result = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            })
            .then(toJson);
            resolve(result);
        });
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

    /**
     * @summary Saves page content, creating a new revision.
     * @param title 
     * @param text 
     */
    public static async commitEditsAsync(title: string, text: string): Promise<EditResult> {
        return new Promise(async (resolve, reject) => {
            let token = await this.getTokenAsync(TokenType.CSRF);
            if (token.query.tokens.csrftoken === '+\\') {
                console.log("rejected");
                return reject(new Error("Could not edit page. Token returned empty. Are you logged in?"));
            }
            let form = new FormData();
            form.append('action', 'edit');
            form.append('title', title);
            form.append('notminor', 'true');
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
            .then(logMessage(`commitEdits with token ${token.query.tokens.csrftoken}`));
        });
    }

    /**
     * @summary Logs into wiki with provided credentials. No state is returned
     * in the body, rather the library keeps a cookie session. This may change
     * in the future to a more transparent/programmatic strategy.
     */
    public static async loginAsync(username: string, password: string): Promise<LoginResult> {
        return new Promise(async (resolve, reject) => {
            let tokenResult = await this.getTokenAsync(TokenType.LOGIN);
            if (tokenResult.query.tokens.logintoken === "+\\") {
                return reject(new Error("Empty login token."));
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
            resolve(response);
        });
    }

    /**
     * Get a revision by ID.
     * @param {id} An ID of a specific revision.
     * @param {next} A continuation token from a previous request. If 
     * supplied, the next page will be returned.
     */
    public static async getRevisionAsync(id: number, next?: string): Promise<RVResult>;
    /**
     * Get the latest revision of an article by its title.
     * @param {title} The title of an article.
     * @param {next} A continuation token from a previous request. If 
     * supplied, the next page will be returned.
     */
    public static async getRevisionAsync(title: string, next?: string): Promise<RVResult>;
    public static async getRevisionAsync(id: string | number, next?: string): Promise<RVResult> {
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

            let response = await fetch(`${WIKI_URL}/api.php`, {
                method: 'POST',
                body: form
            })
            .then(toJson)
            .then(logIt);
            resolve(response);
        });
    }
}

function logIt(result: any) {
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