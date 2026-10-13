import * as vscode from 'vscode';
import * as sessions from './sessions';
import * as gitExtras from './gitExtras';
import * as editorConfig from './editorConfig';
import * as editing from './editing';
import * as httpClient from './httpClient';
import * as csvTable from './csvTable';
import * as bookmarks from './bookmarks';
import * as debugThreads from './debugThreads';
import * as webSearch from './webSearch';
import * as repoMap from './repoMap';
import * as promptTools from './promptTools';
import * as terminalNL from './terminalNL';
import * as commitMsg from './commitMsg';
import * as aiActions from './aiActions';
export function activateFeatures(ctx: vscode.ExtensionContext) {
	for (const f of [sessions, gitExtras, editorConfig, editing, httpClient, csvTable, bookmarks, debugThreads, webSearch, repoMap, promptTools, terminalNL, commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
}
