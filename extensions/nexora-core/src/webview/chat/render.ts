/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

function safeHref(url: string): string | undefined {
	const href = url.trim();
	const protocol = href.replace(/&amp;/g, '&').toLowerCase();
	if (protocol.startsWith('https://') || protocol.startsWith('http://') || protocol.startsWith('mailto:')) {
		return href;
	}
	return undefined;
}

function wrapFence(code: string, lang: string): string {
	const copyId = 'code-' + Math.random().toString(36).slice(2, 11);
	const title = lang || 'Code';
	return (
		'<div class="nx-codeHeader">' +
		'<span class="nx-codeTitle">' + title + '</span>' +
		'<button class="nx-copyBtn" data-copy-target="' + copyId + '">Copy</button>' +
		'</div>' +
		'<pre class="nx-codeBlock" id="' + copyId + '">' +
		code +
		'</pre>'
	);
}

function stash(blocks: string[], html: string): string {
	const token = '%%NXCB' + blocks.length + '%%';
	blocks.push(html);
	return token;
}

function extractFences(html: string, blocks: string[]): string {
	let out = '';
	let i = 0;
	while (i < html.length) {
		const start = html.indexOf('```', i);
		if (start < 0) {
			out += html.slice(i);
			break;
		}
		out += html.slice(i, start);
		const afterOpen = start + 3;
		const close = html.indexOf('```', afterOpen);
		const body = close < 0 ? html.slice(afterOpen) : html.slice(afterOpen, close);
		let lang = '';
		let code = body;
		const nl = body.indexOf('\n');
		if (nl >= 0) {
			const first = body.slice(0, nl).trim();
			if (/^[A-Za-z0-9_+-]*$/.test(first)) {
				lang = first;
				code = body.slice(nl + 1);
			}
		}
		out += stash(blocks, wrapFence(code.trim(), lang));
		if (close < 0) {
			break;
		}
		i = close + 3;
	}
	return out;
}

function applyLists(html: string): string {
	html = html.replace(/(^|\n)((?:[*+-] .+(?:\n|$))+)/g, (_match, lead: string, block: string) => {
		const items = block.replace(/\n$/, '').split('\n').map((line) => {
			return '<li>' + line.replace(/^[*+-] /, '') + '</li>';
		}).join('');
		return lead + '<ul>' + items + '</ul>';
	});
	html = html.replace(/(^|\n)((?:\d+\. .+(?:\n|$))+)/g, (_match, lead: string, block: string) => {
		const items = block.replace(/\n$/, '').split('\n').map((line) => {
			return '<li>' + line.replace(/^\d+\. /, '') + '</li>';
		}).join('');
		return lead + '<ol>' + items + '</ol>';
	});
	return html;
}

function applyInline(html: string): string {
	html = html.replace(/`([^`]+)`/g, '<code class="nx-inlineCode">$1</code>');
	html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
	html = html.replace(/\*\*/g, '');
	html = html.replace(/`/g, '');
	return html;
}

export function formatContent(content: string): string {
	const blocks: string[] = [];
	let html = escapeHtml(String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
	html = extractFences(html, blocks);

	html = html.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="nx-mdH">$1</strong>');
	html = html.replace(/^#{1,6}\s*/gm, '');
	html = applyLists(html);
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
		const href = safeHref(url);
		const label = applyInline(text);
		return stash(blocks, href ? '<a href="' + href + '">' + label + '</a>' : label);
	});
	html = applyInline(html);
	html = html.replace(/\n/g, '<br/>');

	for (let i = 0; i < blocks.length; i++) {
		html = html.split('%%NXCB' + i + '%%').join(blocks[i]);
	}
	return html;
}
