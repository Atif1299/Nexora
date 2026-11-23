/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { agentProcessEnv, setAgentPathPrefix } from './commandRunner';

/**
 * What really works on this PC, checked by running it, before the agent runs
 * anything. In the 8 Nov benchmark `python` and `python3` were Windows Store
 * shortcuts, `py` pointed at a deleted Python and pytest was missing, so the
 * agent spent turn after turn on commands that could never work, then searched
 * the disk. Now:
 *
 *  1. Each tool is run with --version and classified: works, broken (and why),
 *     or not installed. The result goes into the environment block.
 *  2. What can be fixed safely is fixed for agent commands only: the project's
 *     .venv and node_modules/.bin go first on PATH, and when no Python works
 *     but uv does, uv's own Python is put on PATH.
 *  3. When a command still fails with "not found", the result carries a hint
 *     naming what does work (notFoundHint).
 *
 * No VS Code imports, so it can be checked with plain Node.
 */

export interface ToolStatus {
	name: string;
	ok: boolean;
	path?: string;
	version?: string;
	problem?: string;
}

export interface RuntimeReport {
	root: string;
	checkedAt: number;
	/** Tools found on PATH, working or not, after Nexora's PATH fixes. */
	tools: ToolStatus[];
	/** Probed tools that are not on PATH at all. */
	missing: string[];
	venvPython?: { path: string; version?: string };
	/** uv's interpreter, put on PATH because no other Python worked. */
	uvPython?: string;
	/** Folders Nexora puts first on PATH for agent commands. */
	pathPrefix: string[];
	/** From the lockfiles in the workspace root. */
	packageManagers: string[];
	/** One-line advice per area (Python, tests), for the prompt and hints. */
	notes: string[];
}

export const PROBED_TOOLS = [
	'python', 'python3', 'py', 'pip', 'pytest', 'uv',
	'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno',
	'git', 'gh', 'docker', 'java', 'go', 'cargo', 'dotnet', 'php', 'ruby'
];
const PYTHON_FAMILY = new Set(['python', 'python3', 'py', 'pip', 'pip3', 'pytest']);
const NODE_FAMILY = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun']);
const VERSION_ARGS: Record<string, string[]> = { go: ['version'], java: ['-version'] };
const PROBE_TIMEOUT_MS = 6000;
// Re-check after this long, or after a command that installs something.
const PROBE_TTL_MS = 2 * 60 * 1000;
const INSTALL_COMMAND = /\b(pip3?|uv|npm|pnpm|yarn|bun|winget|choco|scoop|brew|apt(-get)?)\b[^|;&]*\b(install|add|sync|venv)\b|\b-m\s+venv\b|\buv\s+(venv|python\s+install)\b/i;

export function firstLine(text: string): string {
	for (const line of String(text || '').split(/\r?\n/)) {
		const t = line.trim();
		if (t) {
			return t.slice(0, 120);
		}
	}
	return '';
}

/** The file `name` resolves to on a PATH value, like `command -v` (Windows: PATHEXT). */
export function findOnPath(name: string, pathValue: string, platform: string = process.platform, exists: (file: string) => boolean = fileExists, pathext?: string): string | undefined {
	const exts = platform === 'win32'
		? (pathext || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
		: [''];
	const delimiter = platform === 'win32' ? ';' : ':';
	for (const dir of String(pathValue || '').split(delimiter)) {
		if (!dir) {
			continue;
		}
		for (const ext of exts) {
			const file = path.join(dir.replace(/^"|"$/g, ''), name + ext);
			if (exists(file)) {
				return file;
			}
		}
	}
	return undefined;
}

function fileExists(file: string): boolean {
	try {
		// lstat: Windows Store app aliases are reparse points that stat() may not follow.
		return !fs.lstatSync(file).isDirectory();
	} catch {
		return false;
	}
}

/** Works / broken from what `<tool> --version` printed. */
export function classify(name: string, file: string, code: number, output: string): ToolStatus {
	const line = firstLine(output);
	if (/[\\/]WindowsApps[\\/]/i.test(file) && /was not found|Microsoft Store/i.test(output)) {
		return { name, ok: false, path: file, problem: 'Windows Store shortcut, not a real install' };
	}
	const missingTarget = /Unable to create process using '([^']+?)(?:\s+--?\w+)*'/i.exec(output);
	if (missingTarget) {
		return { name, ok: false, path: file, problem: `points to a missing program (${missingTarget[1].replace(/"/g, '')})` };
	}
	if (code !== 0) {
		return { name, ok: false, path: file, problem: line ? `fails: ${line}` : `exits with code ${code}` };
	}
	return { name, ok: true, path: file, version: shortVersion(line) };
}

/** "git version 2.50.1.windows.1" -> "2.50.1"; "v22.19.0" -> "22.19.0". */
export function shortVersion(line: string): string | undefined {
	const m = /(\d+\.\d+(?:\.\d+)?)/.exec(line);
	return m ? m[1] : (line.slice(0, 40) || undefined);
}

export function runForVersion(file: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		const script = /\.(cmd|bat)$/i.test(file);
		let child: cp.ChildProcess;
		try {
			child = script
				? cp.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${file}" ${args.join(' ')}`], { env, windowsHide: true, windowsVerbatimArguments: true })
				: cp.spawn(file, args, { env, windowsHide: true });
		} catch (err) {
			resolve({ code: -1, output: err instanceof Error ? err.message : String(err) });
			return;
		}
		let output = '';
		const take = (data: Buffer) => {
			if (output.length < 4096) {
				output += data.toString('utf8');
			}
		};
		child.stdout?.on('data', take);
		child.stderr?.on('data', take);
		const timer = setTimeout(() => child.kill(), timeoutMs);
		child.on('error', (err) => {
			clearTimeout(timer);
			resolve({ code: -1, output: output + err.message });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, output });
		});
	});
}

function pathOf(env: NodeJS.ProcessEnv): string {
	const key = Object.keys(env).find((k) => k.toLowerCase() === 'path');
	return key ? env[key] || '' : '';
}

async function probeTool(name: string, env: NodeJS.ProcessEnv): Promise<ToolStatus | undefined> {
	const file = findOnPath(name, pathOf(env), process.platform, fileExists, env.PATHEXT);
	if (!file) {
		return undefined;
	}
	const result = await runForVersion(file, VERSION_ARGS[name] || ['--version'], env);
	return classify(name, file, result.code, result.output);
}

function venvPythonPath(root: string): string | undefined {
	for (const dir of ['.venv', 'venv', 'env']) {
		const file = process.platform === 'win32'
			? path.join(root, dir, 'Scripts', 'python.exe')
			: path.join(root, dir, 'bin', 'python');
		if (fileExists(file)) {
			return file;
		}
	}
	return undefined;
}

function lockfileManagers(root: string): string[] {
	const found: string[] = [];
	const checks: Array<[string, string]> = [
		['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'],
		['package-lock.json', 'npm'], ['uv.lock', 'uv'], ['poetry.lock', 'poetry'], ['requirements.txt', 'pip (requirements.txt)']
	];
	for (const [file, manager] of checks) {
		if (fileExists(path.join(root, file)) && !found.includes(manager)) {
			found.push(manager);
		}
	}
	return found;
}

/** Advice lines from the final state, for the prompt and for hints. */
export function adviceFor(report: Pick<RuntimeReport, 'tools' | 'venvPython' | 'uvPython'>): string[] {
	const works = (n: string) => report.tools.some((t) => t.name === n && t.ok);
	const notes: string[] = [];
	const uv = works('uv');
	if (report.venvPython) {
		// A venv made by `uv venv` has no pip; `python -m pip` fails there.
		const install = works('pip') ? `\`python -m pip install ...\`${uv ? ' or `uv pip install ...`' : ''}` : uv ? '`uv pip install ...` (it has no pip)' : '`python -m ensurepip` first, then `python -m pip install ...`';
		notes.push(`Python: \`python\` is the project's virtual environment (${report.venvPython.version || 'found'}); install packages into it with ${install}.`);
	} else if (report.uvPython && works('python')) {
		notes.push('Python: `python` is uv\'s Python, put on PATH by Nexora because the system one does not work. For packages, make a project environment first (`uv venv`, then it is used automatically), or run a tool once with `uv run --with <package> <command>`.');
	} else if (works('python')) {
		notes.push('Python: `python` works.');
	} else if (works('python3')) {
		notes.push('Python: use `python3` (`python` does not work here).');
	} else if (works('py')) {
		notes.push('Python: use `py` (`python` does not work here).');
	} else if (uv) {
		notes.push('Python: no working Python on PATH; use `uv run python ...` (uv fetches a Python when needed).');
	} else {
		notes.push('Python: not installed. Ask the user before installing it.');
	}
	if (!works('pytest')) {
		notes.push(uv
			? 'Tests: pytest is not installed; run `uv run --with pytest pytest`, or install it into the project environment.'
			: 'Tests: pytest is not installed; install it into the project environment before running tests.');
	}
	return notes;
}

/** Runs every check. Applies the PATH fixes (setAgentPathPrefix) as a side effect. */
export async function probeRuntimes(root: string): Promise<RuntimeReport> {
	const plain = agentProcessEnv(process.env, false);
	const first = await Promise.all(PROBED_TOOLS.map((name) => probeTool(name, plain)));
	const byName = new Map<string, ToolStatus>();
	first.forEach((status) => status && byName.set(status.name, status));
	const works = (n: string) => !!byName.get(n)?.ok;

	const prefix: string[] = [];
	let venvPython: RuntimeReport['venvPython'];
	let uvPython: string | undefined;
	const venvFile = venvPythonPath(root);
	if (venvFile) {
		const v = await runForVersion(venvFile, ['--version'], plain);
		if (v.code === 0) {
			venvPython = { path: venvFile, version: firstLine(v.output) || undefined };
			prefix.push(path.dirname(venvFile));
		}
	}
	if (!venvPython && !works('python') && !works('python3') && works('uv')) {
		const uvFile = byName.get('uv')!.path!;
		const found = await runForVersion(uvFile, ['python', 'find'], plain, 10000);
		const interpreter = firstLine(found.output);
		if (found.code === 0 && interpreter && fileExists(interpreter)) {
			uvPython = interpreter;
			prefix.push(path.dirname(interpreter));
		}
	}
	const nodeBin = path.join(root, 'node_modules', '.bin');
	try {
		if (fs.statSync(nodeBin).isDirectory()) {
			prefix.push(nodeBin);
		}
	} catch {
		// no local node tools
	}
	setAgentPathPrefix(prefix);

	// Re-check the Python tools on the PATH agent commands will really get.
	if (prefix.length > 0) {
		const fixed = agentProcessEnv(process.env, true);
		const again = await Promise.all(['python', 'python3', 'pip', 'pytest'].map((name) => probeTool(name, fixed)));
		for (const name of ['python', 'python3', 'pip', 'pytest']) {
			byName.delete(name);
		}
		again.forEach((status) => status && byName.set(status.name, status));
	}

	const tools = PROBED_TOOLS.map((n) => byName.get(n)).filter((t): t is ToolStatus => !!t);
	const report: RuntimeReport = {
		root,
		checkedAt: Date.now(),
		tools,
		missing: PROBED_TOOLS.filter((n) => !byName.has(n)),
		venvPython,
		uvPython,
		pathPrefix: prefix,
		packageManagers: lockfileManagers(root),
		notes: []
	};
	report.notes = adviceFor(report);
	return report;
}

const cache = new Map<string, { report: RuntimeReport; stale: boolean }>();
const inFlight = new Map<string, Promise<RuntimeReport>>();

/** The report for `root`, re-checked when older than PROBE_TTL_MS or marked stale. */
export async function ensureRuntimeProbe(root: string): Promise<RuntimeReport> {
	const hit = cache.get(root);
	if (hit && !hit.stale && Date.now() - hit.report.checkedAt < PROBE_TTL_MS) {
		setAgentPathPrefix(hit.report.pathPrefix);
		return hit.report;
	}
	let pending = inFlight.get(root);
	if (!pending) {
		pending = probeRuntimes(root).then((report) => {
			cache.set(root, { report, stale: false });
			return report;
		}).finally(() => inFlight.delete(root));
		inFlight.set(root, pending);
	}
	return pending;
}

/** After an install command, check again before the next command. */
export function noteCommandRan(root: string, command: string): void {
	const hit = cache.get(root);
	if (hit && INSTALL_COMMAND.test(command)) {
		hit.stale = true;
	}
}

export function cachedRuntimeReport(root: string): RuntimeReport | undefined {
	return cache.get(root)?.report;
}

/** The report as short lines for the engine's environment block. */
export function runtimesForPrompt(report: RuntimeReport): Record<string, unknown> {
	const label = (t: ToolStatus) => {
		if (t.name === 'python' && report.venvPython) {
			return `python (project .venv, ${t.version || ''})`.replace(', )', ')');
		}
		if (t.name === 'python' && report.uvPython) {
			return `python (uv's Python ${t.version || ''}, put on PATH by Nexora)`.replace(' ,', ',');
		}
		return t.version ? `${t.name} ${t.version}` : t.name;
	};
	return {
		working: report.tools.filter((t) => t.ok).map(label),
		broken: report.tools.filter((t) => !t.ok).map((t) => `${t.name} (${t.problem})`),
		missing: report.missing,
		package_managers: report.packageManagers,
		notes: report.notes
	};
}

const NOT_FOUND = /command not found|is not recognized as (?:the name of a cmdlet|an internal or external command)|was not found; run without arguments to install from the Microsoft Store|Unable to create process using|No module named|cannot find the path specified/i;

/** The program a failed command could not run, from the error text or the command itself. */
export function failedProgram(command: string, output: string): string | undefined {
	const fromBash = /(?:^|\n)(?:[^:\n]*: )?(?:line \d+: )?([\w.+-]+): command not found/.exec(output);
	if (fromBash) {
		return fromBash[1];
	}
	const fromPwsh = /The term '([^']+)' is not recognized/.exec(output) || /'([^']+)' is not recognized as an internal/.exec(output);
	if (fromPwsh) {
		return path.basename(fromPwsh[1]).replace(/\.(exe|cmd|bat)$/i, '');
	}
	const moduleMissing = /No module named '?([\w.]+)/.exec(output);
	if (moduleMissing) {
		return moduleMissing[1] === 'pytest' ? 'pytest' : `python module ${moduleMissing[1]}`;
	}
	const head = command.trim().split(/\s+/)[0] || '';
	return path.basename(head.replace(/^["']|["']$/g, '')).replace(/\.(exe|cmd|bat)$/i, '') || undefined;
}

/**
 * For a command that failed because a program is missing or broken: what is
 * wrong with it and what works instead. Undefined when the failure is
 * something else.
 */
export function notFoundHint(command: string, output: string, exitCode: number | null, report: RuntimeReport | undefined): string | undefined {
	if (!report || exitCode === 0 || !NOT_FOUND.test(output)) {
		return undefined;
	}
	const program = failedProgram(command, output);
	if (!program) {
		return undefined;
	}
	const status = report.tools.find((t) => t.name === program);
	const lines: string[] = [];
	if (program.startsWith('python module ')) {
		lines.push(`The Python that ran has no ${program.slice(14)} installed.`);
	} else {
		lines.push(`\`${program}\` does not work in this shell: ${status && !status.ok ? status.problem : 'it is not installed or not on PATH'}.`);
	}
	const isPython = PYTHON_FAMILY.has(program) || program.startsWith('python module ');
	if (isPython) {
		lines.push(...report.notes);
	} else if (NODE_FAMILY.has(program)) {
		const node = report.tools.filter((t) => t.ok && NODE_FAMILY.has(t.name)).map((t) => t.name);
		lines.push(node.length ? `Working Node tools here: ${node.join(', ')}.` : 'Node.js is not installed here. Ask the user before installing it.');
	}
	const working = report.tools.filter((t) => t.ok).map((t) => t.name);
	if (working.length) {
		lines.push(`Everything that works here: ${working.join(', ')}.`);
	}
	lines.push('Use one of those. Do not search the disk for other installs, and ask the user before installing anything.');
	return lines.join(' ');
}
