import assert from 'node:assert/strict';
import test from 'node:test';
import { loginUrlFromAuthResult, selectAcpAuthMethod } from '../src/acpAuth.ts';
import { isOfficialCursorDownloadUrl, parseCursorInstallScript, preferredCursorExecutable } from '../src/cursorCliResolve.ts';

const POSIX_SCRIPT = `
DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.10.16-e3cb207/\${OS}/\${ARCH}/agent-cli-package.tar.gz"
`;

const WIN_SCRIPT = `
$downloadUrl = 'https://downloads.cursor.com/lab/2026.10.16-e3cb207/'
$version = '2026.10.16-e3cb207'
$fullUrl = $UrlPrefix + "windows/$architecture/agent-cli-package.zip"
`;

test('posix installer script resolves the official linux tarball', () => {
	const release = parseCursorInstallScript(POSIX_SCRIPT, 'linux', 'x64');
	assert.deepEqual(release, {
		version: '2026.10.16-e3cb207',
		downloadUrl: 'https://downloads.cursor.com/lab/2026.10.16-e3cb207/linux/x64/agent-cli-package.tar.gz',
		archive: 'tar.gz',
		target: { id: 'linux-x64', os: 'linux', arch: 'x64', archive: 'tar.gz' },
	});
	assert.equal(isOfficialCursorDownloadUrl(release.downloadUrl), true);
});

test('posix installer script resolves darwin arm64', () => {
	const release = parseCursorInstallScript(POSIX_SCRIPT, 'darwin', 'arm64');
	assert.equal(release.downloadUrl, 'https://downloads.cursor.com/lab/2026.10.16-e3cb207/darwin/arm64/agent-cli-package.tar.gz');
	assert.equal(release.target.id, 'darwin-arm64');
});

test('windows installer script resolves the official zip', () => {
	const release = parseCursorInstallScript(WIN_SCRIPT, 'win32', 'arm64');
	assert.equal(release.downloadUrl, 'https://downloads.cursor.com/lab/2026.10.16-e3cb207/windows/arm64/agent-cli-package.zip');
	assert.equal(release.archive, 'zip');
	assert.equal(release.target.id, 'windows-arm64');
});

test('a script that points off the official host is refused', () => {
	assert.throws(() => parseCursorInstallScript('DOWNLOAD_URL="https://example.com/lab/2026.10.16-e3cb207/${OS}/${ARCH}/agent-cli-package.tar.gz"', 'linux', 'x64'));
	assert.equal(isOfficialCursorDownloadUrl('https://example.com/lab/2026.10.16-e3cb207/linux/x64/agent-cli-package.tar.gz'), false);
	assert.equal(isOfficialCursorDownloadUrl('http://downloads.cursor.com/lab/x'), false);
});

test('unsupported hosts have no package', () => {
	assert.throws(() => parseCursorInstallScript(POSIX_SCRIPT, 'freebsd', 'x64'));
	assert.throws(() => parseCursorInstallScript(POSIX_SCRIPT, 'linux', 'ia32'));
});

test('executable preference follows the official package names', () => {
	assert.equal(preferredCursorExecutable(['/opt/agent', '/opt/cursor-agent']), '/opt/cursor-agent');
	assert.equal(preferredCursorExecutable(['C:/pkg/agent.cmd', 'C:/pkg/cursor-agent.exe']), 'C:/pkg/cursor-agent.exe');
	assert.equal(preferredCursorExecutable(['/opt/readme']), undefined);
});

test('Cursor ACP login is not skipped', () => {
	assert.equal(selectAcpAuthMethod({ name: 'cursor', authMethod: 'cursor_login' }, {}), 'cursor_login');
	assert.equal(selectAcpAuthMethod({ name: 'cursor' }, { authMethods: [{ id: 'cursor_login' }] }), 'cursor_login');
	assert.equal(selectAcpAuthMethod({ name: 'cursor' }, { authMethods: [{ id: 'other' }] }), 'other');
	assert.equal(selectAcpAuthMethod({ name: 'gemini' }, {}), undefined);
	assert.equal(selectAcpAuthMethod({ name: 'gemini' }, { authMethods: [{ id: 'gemini' }] }), 'gemini');
	assert.equal(selectAcpAuthMethod({ name: 'gemini', authMethod: 'gemini_login' }, { authMethods: [{ id: 'gemini_login' }] }), 'gemini_login');
	assert.equal(loginUrlFromAuthResult({ loginUrl: 'https://cursor.com/login/abc' }), 'https://cursor.com/login/abc');
	assert.equal(loginUrlFromAuthResult({}), undefined);
	assert.equal(loginUrlFromAuthResult({ url: 'http://cursor.com/insecure' }), undefined);
});
