const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

function argvPath() {
  const product = (() => { try { return require(path.join(vscode.env.appRoot, 'product.json')); } catch { return {}; } })();
  const folder = product.dataFolderName || '.axiora-code';
  const portable = process.env.VSCODE_PORTABLE;
  return portable ? path.join(portable, 'argv.json') : path.join(os.homedir(), folder, 'argv.json');
}

function writeLocale(locale) {
  const p = argvPath();
  let text = '{\n}\n';
  try { text = fs.readFileSync(p, 'utf8'); } catch { }
  if (/"locale"\s*:\s*"[^"]*"/.test(text)) {
    text = text.replace(/"locale"\s*:\s*"[^"]*"/, `"locale": "${locale}"`);
  } else {
    const i = text.lastIndexOf('}');
    const body = text.slice(0, i).replace(/\s*$/, '');
    const needsComma = /[}\]"\w]\s*$/.test(body.replace(/\/\/.*$/gm, '').trim()) && !/\{\s*$/.test(body.replace(/\/\/.*$/gm, '').trim());
    text = body + (needsComma ? ',' : '') + `\n\t"locale": "${locale}"\n` + text.slice(i);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

async function applyLanguage(lang) {
  const current = vscode.env.language.startsWith('ar') ? 'ar' : 'en';
  if (lang === current) { return; }
  writeLocale(lang);
  const restart = lang === 'ar' ? 'إعادة التشغيل الآن' : 'Restart Now';
  const msg = lang === 'ar' ? 'تم ضبط لغة الواجهة على العربية. أعد تشغيل Axiora-Code لتطبيق التغيير.' : 'Display language set to English. Restart Axiora-Code to apply.';
  const pick = await vscode.window.showInformationMessage(msg, restart);
  if (pick === restart) {
    relaunch();
    await vscode.commands.executeCommand('workbench.action.quit');
  }
}

function appExecutable() {
  const root = path.resolve(vscode.env.appRoot, '..', '..');
  if (process.platform === 'win32') {
    const exe = fs.readdirSync(root).find(f => /\.exe$/i.test(f) && !/^(unins|inno|crashpad)/i.test(f));
    return exe ? path.join(root, exe) : undefined;
  }
  if (process.platform === 'darwin') { return path.resolve(vscode.env.appRoot, '..', '..', '..'); }
  const product = (() => { try { return require(path.join(vscode.env.appRoot, 'product.json')); } catch { return {}; } })();
  return path.join(root, product.applicationName || 'axiora-code');
}

function relaunch() {
  const cp = require('child_process');
  const exe = appExecutable();
  if (!exe) { return; }
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; delete env.VSCODE_IPC_HOOK_CLI; delete env.VSCODE_PID; delete env.VSCODE_CWD;
  let child;
  if (process.platform === 'win32') {
    child = cp.spawn('cmd.exe', ['/d', '/c', `ping -n 4 127.0.0.1 >nul & start "" "${exe}"`], { detached: true, stdio: 'ignore', windowsHide: true, env });
  } else if (process.platform === 'darwin') {
    child = cp.spawn('/bin/sh', ['-c', `sleep 3; open "${exe}"`], { detached: true, stdio: 'ignore', env });
  } else {
    child = cp.spawn('/bin/sh', ['-c', `sleep 3; "${exe}" ${process.env.AXIORA_NO_SANDBOX ? '--no-sandbox' : ''}`], { detached: true, stdio: 'ignore', env });
  }
  child.unref();
}

function activate(context) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('axiora.language')) {
        applyLanguage(vscode.workspace.getConfiguration('axiora').get('language', 'en'));
      }
    }),
    vscode.commands.registerCommand('axiora.switchLanguage', async () => {
      const p = await vscode.window.showQuickPick([{ label: 'English', id: 'en' }, { label: 'العربية', id: 'ar' }], { placeHolder: 'Display language / لغة الواجهة' });
      if (p) { await vscode.workspace.getConfiguration('axiora').update('language', p.id, vscode.ConfigurationTarget.Global); }
    }),
    vscode.commands.registerCommand('axiora.openWelcome', () => openWelcome(context))
  );
  const cfg = vscode.workspace.getConfiguration('axiora');
  if (cfg.get('showWelcomeOnStartup', true) && !context.globalState.get('axiora.welcomeShown')) {
    context.globalState.update('axiora.welcomeShown', true);
    openWelcome(context);
  }
}

function openWelcome(context) {
  const uri = vscode.Uri.joinPath(context.extensionUri, 'media', 'WELCOME.md');
  vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, () => vscode.window.showTextDocument(uri));
}

module.exports = { activate, deactivate() { } };
