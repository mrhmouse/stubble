import $ = require('jquery');

/**
 * A Mustache-like template for the DOM.
 * Differences from Mustache:
 * - Uses two curly brackets for all placeholders
 * - Raw content is inserted by passing a Node or JQuery object
 * - No implicit 'each' helper - you must specify the helper you
 *   want to call, e.g. {{#each items}}, not {{#items}}
 * - No path traversal via '..', e.g. {{../foo}} will not work
 */
export class Template {
	private tokens: Token[];
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
		this.tokens = Template.parse(temp);
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
		let tokens = cloneTokens(this.tokens);
		let result = document.createElement('div');
		this.consumeTokens(result, tokens, data);

		return $(result).contents();
	}

	/**
	 * ADVANCED: Pop all tokens from the token stream and handle them.
	 * @param target The element where token data is appended.
	 * @param tokens The token stream. This will be consumed.
	 * @param data Any data to pass to tokens (from the 'render' call)
	 */
	consumeTokens(target: Node, tokens: Token[], data: {}) {
		while (tokens.length) {
			let token = tokens.shift();
			if (isText(token)) {
				this.handleText(target, token);
			} else if (isField(token)) {
				this.handleField(target, token, tokens, data);
			} else if (isNode(token)) {
				this.handleNode(target, token, data);
			}
		}
	}

	private handleNode(target: Node, token: NodeToken, data: {}) {
		if (!token.node) {
			return;
		}

		target.appendChild(token.node);
		Template.resolveAttributes(token.node, data);
		this.consumeTokens(token.node, token.tokens, data);
	}

	private handleField(
		target: Node,
		fieldToken: FieldToken,
		tokens: Token[],
		data: {})
	{
		if (fieldToken.field[0] === '#') {
			let helper = Template.findHelper(fieldToken.field.substr(1));
			if (helper) {
				let block = new Block(fieldToken, tokens);
				helper.run(target, this, block, data);
			}
		} else {
			let field = resolvePath(data, fieldToken.field);
			append(target, field);
		}
	}

	private handleText(target: Node, token: TextToken) {
		append(target, token.text);
	}

	private static parse(templateContainer: Node): Token[] {
		let nodes = slice(templateContainer.childNodes);
		if (templateContainer.nodeType === Node.TEXT_NODE) {
			nodes = [templateContainer];
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
						tokens.push({ type: 'text', text: results[3] });
					} else {
						tokens.push({ type: 'text', text: results[1] });
						tokens.push({ type: 'field', field: results[2] });
					}
				}

				tokens.push({ type: 'text', text: text });
			} else {
				let parsed = Template.parse(node);
				tokens.push({ type: 'node', node: node, tokens: parsed });
			}
		}

		return tokens;
	}

	private static resolveAttributes(e: Node, data: {}) {
		if (e instanceof Element && e.attributes.length) {
			let attributes = slice(e.attributes);
			for (let attr of attributes) {
				let value = e.getAttribute(attr.name);
				value = replaceText(value, data);
				e.setAttribute(attr.name, value);
			}
		}
	}
}

function append(target: Node, content: any) {
	let node: Node = null;
	if (content instanceof Node) {
		node = content;
	} else if (isJQuery(content)) {
		node = content[0];
	} else if (content != null) {
		node = document.createTextNode(content.toString());
	}

	target.appendChild(node);
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
 * Make a shallow clone of the given node, including its attributes
 * but not its child nodes.
 * @param e The node to clone.
 */
function shallowClone(e: Node): Node {
	if (e.nodeType === Node.TEXT_NODE) {
		return document.createTextNode(e.textContent);
	} else if (e.nodeType !== Node.ELEMENT_NODE) {
		return null;
	}

	let clone = document.createElement(e.nodeName);
	for (let attr of slice(e.attributes)) {
		clone.setAttribute(attr.name, attr.value);
	}

	return clone;
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
	tokens: Token[];
}

export function isNode(t: Token): t is NodeToken {
	return t.type === 'node';
}

export interface FieldToken {
	type: 'field';
	field: string;
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
				node: shallowClone(token.node),
				tokens: cloneTokens(token.tokens)
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
		template.consumeTokens(element, choice, newContext);
	}
});

Template.registerHelper({
	name: 'if',
	run: function (element, template, block, data) {
		let result = resolvePath(data, block.arg);
		let branch = result ? block.first : block.second;
		template.consumeTokens(element, branch, data);
	}
});

Template.registerHelper({
	name: 'each',
	run: function (element, template, block, data) {
		let field = resolvePath(data, block.arg);
		if (hasLength(field)) {
			for (let item of field) {
				let copy = cloneTokens(block.first);
				template.consumeTokens(element, copy, item);
			}
		} else {
			template.consumeTokens(element, block.second, data);
		}
	}
});

function hasLength(x: any): x is any[] {
	return x != null && x.length;
}

function isJQuery(x: any): x is JQuery {
	return x instanceof $;
}

interface ArrayLike<T> {
	[index: number]: T;
	length: number;
}

function slice<T>(x: ArrayLike<T>): T[] {
	return Array.prototype.slice.call(x);
}