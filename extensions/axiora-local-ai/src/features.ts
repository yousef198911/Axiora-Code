import * as vscode from 'vscode';
import * as userScripts from './userScripts';
import * as whichKey from './whichKey';
import * as remote2 from './remote2';
import * as shareChat from './shareChat';
import * as sshFs from './sshFs';
import * as shelve from './shelve';
import * as rebase from './rebase';
import * as dataCells from './dataCells';
import * as docsTypeset from './docsTypeset';
import * as kubernetes from './kubernetes';
import * as mcpServer from './mcpServer';
import * as docker from './docker';
import * as database from './database';
import * as htmlPreview from './htmlPreview';
import * as vim from './vim';
import * as structural from './structural';
import * as goals from './goals';
import * as lintLoop from './lintLoop';
import * as macros from './macros';
import * as usage from './usage';
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
	for (const f of [userScripts, whichKey, remote2, shareChat, sshFs, shelve, rebase, dataCells, docsTypeset, kubernetes, mcpServer, docker, database, htmlPreview, vim, structural, goals, lintLoop, macros, usage, sessions, gitExtras, editorConfig, editing, httpClient, csvTable, bookmarks, debugThreads, webSearch, repoMap, promptTools, terminalNL, commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
}
