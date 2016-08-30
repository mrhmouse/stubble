import $ = require('jquery');

/**
 * A Mustache-like template for the DOM.
 * Differences from Mustache:
 * - Uses two curl brackets for all placeholders
 * - Raw content is inserted by passing a Node or JQuery object
 * - No implicit 'each' helper - you must specify the helper you
 *   want to call, e.g. {{#each items}}, not {{#items}}
 * - No path traversal via '..', e.g. {{../foo}} will not work
 */
export class Template {
	private nodes: Node[];
	private static helpers: Helper[] = [];

	/**
	 * Create a new template from string content.
	 * @param template The string content of the template.
	 * This is parsed by the browser as HTML, so top-level
	 * bare strings will not work (they must be wrapped in a tag).
	 */
	constructor(template: string) {
		let temp = document.createElement('div');
		temp.innerHTML = template;
		this.nodes = slice<Node>(temp.childNodes);
	}

	/**
	 * ADVANCED: Register a helper for use in further templates.
	 * Helpers are invoked via block syntax, e.g. {{#foo}}{{/foo}}
	 * @param helper The helper itself.
	 */
	static registerHelper(helper: Helper) {
		Template.helpers.unshift(helper);
	}

	/**
	 * ADVANCED: Look up a helper by name.
	 * @param name The name of the helper.
	 */
	static findHelper(name: string): Helper {
		let firstWord = name.split(' ')[0];
		for (let entry of Template.helpers) {
			if (entry.name === firstWord) {
				return entry;
			}
		}

		return null;
	}

	/**
	 * Render this template to a JQuery collection.
	 * @param data Any data to pass to the template.
	 */
	render(data: {}): JQuery {
		let result = document.createElement('div');
		for (let node of this.nodes) {
			result.appendChild(node.cloneNode(true));
		}

		this.resolve(result, data);
		return $(result).contents();
	}

	/**
	 * ADVANCED: Pop the next token from the token stream and handle it.
	 * @param e The current element, where token data is appended.
	 * @param tokens The token stream. This may be modified.
	 * @param data Any data to pass to tokens (from the 'render' call)
	 */
	handleNextToken(e: Node, tokens: Token[], data: {}) {
		let token = tokens.shift();
		if (isText(token)) {
			this.handleText(e, token);
		} else if (isField(token)) {
			this.handleField(e, token, tokens, data);
		} else if (isNode(token)) {
			this.handleNode(e, token, data);
		}
	}

	private resolve(e: Node, data: {}) {
		if (e instanceof Element && e.attributes.length) {
			Template.resolveAttributes(e, data);
		}

		let tokens = Template.parse(e, data);
		clearNode(e);
		while (tokens.length) {
			this.handleNextToken(e, tokens, data);
		}
	}

	private handleNode(e: Node, token: NodeToken, data: {}) {
		e.appendChild(token.node);
		this.resolve(token.node, data);
	}

	private handleField(e: Node, token: FieldToken, tokens: Token[], data: {}) {
		if (token.field[0] === '#') {
			let helper = Template.findHelper(token.field.substr(1));
			if (helper) {
				let block = new Block(token, tokens);
				helper.run(e, this, block, data);
			}
		} else {
			let field = resolvePath(data, token.field);
			append(e, field);
		}
	}

	private handleText(e: Node, token: TextToken) {
		append(e, token.text);
	}

	private static parse(e: Node, data: {}): Token[] {
		let nodes = slice<Node>(e.childNodes);
		if (e.nodeType === Node.TEXT_NODE) {
			nodes = [e];
		}

		let tokens = [];

		for (let node of nodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				let re = /(.*?){{(.+?)}}|(.+)/ig;
				let text = node.textContent;
				let results = [];
				while (results = re.exec(text)) {
					text = text.substr(re.lastIndex);
					re.lastIndex = 0;
					if (results[3]) {
						tokens.push({
							type: 'text',
							text: results[3]
						});
					} else {
						tokens.push({
							type: 'text',
							text: results[1]
						});
						tokens.push({
							type: 'field',
							field: results[2],
							data: data
						});
					}
				}

				tokens.push({
					type: 'text',
					text: text
				});
			} else {
				tokens.push({
					type: 'node',
					node: node,
					data: data
				});
			}
		}

		return tokens;
	}

	private static resolveAttributes(e: Element, data: {}) {
		let attributes = slice<Attr>(e.attributes);
		for (let attr of attributes) {
			e.setAttribute(attr.name, replaceText(e.getAttribute(attr.name), data));
		}
	}
}

function append(e: Node, content: any) {
	let node: Node = null;
	if (content instanceof Node) {
		node = content;
	} else if (isJQuery(content)) {
		node = content[0];
	} else if (content != null) {
		node = document.createTextNode(content.toString());
	}

	if (e.nodeType === Node.TEXT_NODE) {
		if (e.parentNode) {
			e.parentNode.replaceChild(node, e);
		}
	} else {
		e.appendChild(node);
	}
}

/**
 * Replace any placeholders of the form {{field}} in the given string.
 * @param template A string containing placeholders.
 * @param data Data used to resolve placeholders.
 */
function replaceText(template: string, data: {}): string {
	return template.replace(/{{(\S+)}}/ig, (match, path) => {
		let field = resolvePath(data, path);
		if (field != null) return field.toString();
		return '';
	});
}

/**
 * Remove all children from the given node.
 * @param e The node to empty.
 */
function clearNode(e: Node) {
	while (e.childNodes.length) {
		e.removeChild(e.childNodes[0]);
	}
}

/**
 * ADVANCED: Resolve the text version of a property path on an object.
 * @param data The object.
 * @param path The property path, e.g. 'foo.bar'.
 */
export function resolvePath(data: {}, path: string) {
	for (let name of path.split('.')) {
		if (data == null) break;
		if (name !== 'this') {
			data = data[name];
		}
	}

	return data;
}

/**
 * ADVANCED: A token, parsed from a template.
 * This is used to run the template engine.
 */
export type Token = TextToken | NodeToken | FieldToken;

export interface TextToken {
	type: 'text';
	text: string;
}

export function isText(t: Token): t is TextToken {
	return t.type === 'text';
}

export interface NodeToken {
	type: 'node';
	node: Node;
	data: {};
}

export function isNode(t: Token): t is NodeToken {
	return t.type === 'node';
}

export interface FieldToken {
	type: 'field';
	field: string;
	data: {};
}

export function isField(t: Token): t is FieldToken {
	return t.type === 'field';
}

/**
 * ADVANCED: A helper function that can be invoked from a template
 * via the block syntax {{#foo}}{{/foo}}
 */
export interface Helper {
	/** The name of the helper */
	name: string;
	run: (e: Node, template: Template, block: Block, data: {}) => void;
}

/**
 * ADVANCED: A block of tokens appearing between block delimiters
 */
export class Block {
	constructor(blockStart: FieldToken, tokens: Token[]) {
		this.first = [];
		this.second = [];

		let depth = 1;
		let block = this.first;
		this.arg = blockStart.field.substr(blockStart.field.indexOf(' ') + 1);
		while (tokens.length) {
			let token = tokens.shift();
			if (isField(token)) {
				if (token.field[0] === '/') {
					if (--depth === 0) {
						break;
					}
				} else if (token.field[0] === '#') {
					depth++;
				} else if (token.field === 'else' && depth === 1) {
					block = this.second;
					continue;
				}
			}

			block.push(token);
		}
	}

	/** The argument string passed into the opening block delimiter */
	arg: string;

	/** The tokens appearing between delimiters, before the {{else}} */
	first: Token[];

	/** The tokens after the {{else}} */
	second: Token[];
}

/**
 * ADVANCED: Make a clone of the token stream.
 * @param tokens The token stream.
 */
export function cloneTokens(tokens: Token[]): Token[] {
	let clone = [];
	for (let token of tokens) {
		if (isNode(token)) {
			clone.push({
				type: 'node',
				data: token.data,
				node: token.node.cloneNode(true)
			});
		} else {
			clone.push(token);
		}
	}

	return clone;
}

Template.registerHelper({
	name: 'with',
	run: function (element, template, block, data) {
		let newContext = resolvePath(data, block.arg);
		let choice = newContext ? block.first : block.second;
		while (choice.length) {
			template.handleNextToken(element, choice, newContext);
		}
	}
});

Template.registerHelper({
	name: 'if',
	run: function (element, template, block, data) {
		let result = resolvePath(data, block.arg);
		let branch = result ? block.first : block.second;
		while (branch.length) {
			template.handleNextToken(element, branch, data);
		}
	}
});

Template.registerHelper({
	name: 'each',
	run: function (element, template, block, data) {
		let field = resolvePath(data, block.arg);
		if (hasLength(field)) {
			for (let item of field) {
				let copy = cloneTokens(block.first);
				while (copy.length) {
					template.handleNextToken(element, copy, item);
				}
			}
		} else {
			while (block.second.length) {
				template.handleNextToken(element, block.second, data);
			}
		}
	}
});

function hasLength(x: any): x is any[] {
	return x != null && x.length;
}

function isJQuery(x: any): x is JQuery {
	return x instanceof $;
}

function slice<T>(x: any): T[] {
	return Array.prototype.slice.call(x);
}