import $ = require('jquery');

/**
 * A templating engine for the DOM, with syntax
 * loosely inspired by Mustache.
 */
export class Template {
    static helpers: HashMap<Helper> = {};
    private recipes: Recipe[];

    constructor(template: string) {
	let tokens = parseTokens(template);
	let recipes = tokensToRecipes(tokens);
	this.recipes = optimizeRecipes(recipes);
    }

    /**
     * Render this template to a JQuery collection.
     * @param data Data used to resolve placeholders in the template.
     */
    render(data: {}) {
	let target = document.createElement('div');
	for (let recipe of this.recipes) {
	    recipe.renderInto(target, data);
	}

	return $(target).contents();
    }
}

// The 'each' helper loops over the collection passed to it,
// calling the default branch with the context set to each item
// in turn. If the collection is empty (or isn't a collection),
// then the 'else' branch is called with the original context.
Template.helpers['each'] = {
    renderInto: function (target, data, block) {
	let collection = resolvePath(block.path, data);
	if (hasLength(collection)) {
	    for (let item of collection) {
		for (let recipe of block.defaultBranch) {
		    recipe.renderInto(target, item);
		}
	    }
	} else {
	    for (let recipe of block.elseBranch) {
		recipe.renderInto(target, data);
	    }
	}
    }
};

// The 'if' helper checks whether the value passed to it is
// truthy. If it is, then the default branch is called. Otherwise,
// the 'else' branch is called.
Template.helpers['if'] = {
    renderInto: function (target, data, block) {
	let result = resolvePath(block.path, data);
	let branch = block.defaultBranch;
	if (!result) {
	    branch = block.elseBranch;
	}

	for (let recipe of branch) {
	    recipe.renderInto(target, data);
	}
    }
};

// The 'with' helper is very much like the 'if' helper,
// except that before calling its default branch, it sets
// the context to the value being tested. During the 'else'
// branch, the context is unchanged.
Template.helpers['with'] = {
    renderInto: function (target, data, block) {
	let result = resolvePath(block.path, data);
	if (result) {
	    for (let recipe of block.defaultBranch) {
		recipe.renderInto(target, result);
	    }
	} else {
	    for (let recipe of block.elseBranch) {
		recipe.renderInto(target, data);
	    }
	}
    }
};

/**
 * Quick & dirty lookup table
 */
export interface HashMap<T> {
    [name: string]: T;
}

/**
 * ADVANCED
 * Helpers are blocks of logic that can be invoked from templates
 * via the {{#block args}}...{{/block}} syntax.
 */
export interface Helper {
    /**
     * Render this helper into the target element with the given data.
     * @param target The target element
     * @param data Data used to resolve placeholders
     * @param block The recipe parsed from the original template.
     * This contains the block branches & any arguments.
     */
    renderInto(target: Element, data: {}, block: BlockRecipe): void;
}

/**
 * ADVANCED
 * Recipes are what actually render content within a template.
 */
export interface Recipe {
    renderInto(target: Element, data: {}): void;
}

/**
 * ADVANCED
 * A block recipe is the parsed version of a helper invocation.
 * You should use this class from your helper to execute one of
 * its branches (or possibly both).
 */
export class BlockRecipe implements Recipe {
    name: string;
    path: string[];
    currentBranch: Recipe[];
    defaultBranch: Recipe[];
    elseBranch: Recipe[];
    helper: Helper;

    constructor(block: BlockStartToken) {
	this.name = block.name;
	this.path = block.path;
	this.defaultBranch = [];
	this.elseBranch = [];
	this.currentBranch = this.defaultBranch;
	this.helper = Template.helpers[this.name];
	if (!this.helper) {
	    throw new UnknownHelperError(this.name);
	}
    }

    pushRecipe(recipe: Recipe) {
	if (recipe instanceof FieldRecipe
	    && recipe.path.length === 1
	    && recipe.path[0] === 'else') {
	    this.currentBranch = this.elseBranch;
	    return;
	}

	this.currentBranch.push(recipe);
    }

    renderInto(target: Element, data: {}) {
	this.helper.renderInto(target, data, this);
    }
}

/**
 * ADVANCED
 * The token that begins a helper invocation.
 */
export class BlockStartToken {
    name: string;
    path: string[];

    constructor(text: string) {
	let split = text.split(' ');
	this.name = split[0].substr(1);
	this.path = (split[1] || '').split('.');
    }
}

////////////////////////////////
//// Implementation details ////
////////////////////////////////

/**
 * A token is the first step from raw text to executable template.
 * A flat stream of these tokens eventually becomes a tree structure
 * of recipes, which is used to render the template.
 */
type Token
    = NodeToken
    | FieldToken
    | TextToken
    | BlockStartToken
    | BlockEndToken;

class NodeToken {
    nodeName: string;
    attributes: AttributeRecipe[];
    childTokens: Token[];

    constructor(e: Element) {
	this.nodeName = e.nodeName;
	this.attributes = [];
	for (let attr of slice(e.attributes)) {
	    this.attributes.push({
		name: attr.name,
		value: attr.value
	    });
	}

	this.childTokens = nodesToTokens(slice(e.childNodes));
    }
}

class FieldToken {
    path: string[];

    constructor(text: string) {
	this.path = text.split('.');
    }
}

class BlockEndToken {
    name: string;

    constructor(text: string) {
	this.name = text.substr(1);
    }
}

class TextToken {
    text: string;

    constructor(text: string) {
	this.text = text;
    }
}

interface AttributeRecipe {
    name: string;
    value: string;
}

/**
 * The parse state is used to convert a token stream to
 * a recipe stream.
 */
class ParseState {
    private index: number;
    private tokens: Token[];
    private recipes: Recipe[];
    private length: number;
    private blockState: BlockRecipe[];

    constructor(tokens: Token[]) {
	this.index = 0;
	this.tokens = tokens;
	this.recipes = [];
	this.length = tokens.length;
	this.blockState = [];
    }

    /**
     * Consume the tokens in the token stream, producing recipes.
     */
    parseToEnd() {
	while (!this.atEndOfStream()) {
	    let token = this.nextToken();
	    if (token instanceof NodeToken) {
		this.pushRecipe(new NodeRecipe(token));
	    } else if (token instanceof FieldToken) {
		this.pushRecipe(new FieldRecipe(token));
	    } else if (token instanceof TextToken) {
		this.pushRecipe(new TextRecipe(token.text));
	    } else if (token instanceof BlockStartToken) {
		this.startBlock(token);
	    } else if (token instanceof BlockEndToken) {
		this.endBlock(token);
	    } else {
		throw new InvalidTokenError(token);
	    }
	}

	return this.recipes;
    }

    private endBlock(end: BlockEndToken) {
	let block = this.blockState.pop();
	if (block.name !== end.name) {
	    throw new UnexpectedBlockEndError(end.name, block.name);
	}

	this.pushRecipe(block);
    }

    private startBlock(block: BlockStartToken) {
	let recipe = new BlockRecipe(block);
	this.blockState.push(recipe);
    }

    private atEndOfStream() {
	return this.index >= this.length;
    }

    private nextToken() {
	return this.tokens[this.index++];
    }

    private pushRecipe(recipe: Recipe) {
	let length = this.blockState.length;
	if (length) {
	    this.blockState[length - 1].pushRecipe(recipe);
	} else {
	    this.recipes.push(recipe);
	}
    }
}

/**
 * A simple text literal with no placeholders.
 */
class TextRecipe implements Recipe {
    text: string;
    constructor(text: string) {
	this.text = text;
    }

    renderInto(target: Element, data: {}) {
	target.appendChild(document.createTextNode(this.text));
    }
}

/**
 * A placeholder that references a field in the context.
 */
class FieldRecipe implements Recipe {
    path: string[];
    constructor(token: FieldToken) {
	this.path = token.path;
    }

    renderInto(target: Element, data: {}) {
	data = resolvePath(this.path, data);
	if (data instanceof Node) {
	    target.appendChild(data);
	} else if (isJQuery(data)) {
	    data.each(function (i, el) {
		target.appendChild(el);
	    });
	} else if (data != null) {
	    target.appendChild(document.createTextNode(data.toString()));
	}
    }
}

/**
 * A node that contains attributes & more recipes.
 */
class NodeRecipe implements Recipe {
    static placeholderRegex = /{{(.+?)}}/;
    nodeName: string;
    attributes: AttributeRecipe[];
    childRecipes: Recipe[];

    constructor(token: NodeToken) {
	this.nodeName = token.nodeName;
	this.attributes = token.attributes;
	this.childRecipes = tokensToRecipes(token.childTokens);
    }

    renderInto(target: Element, data: {}) {
	let element = document.createElement(this.nodeName);
	for (let attr of this.attributes) {
	    let value = NodeRecipe.replacePlaceholders(attr.value, data);
	    element.setAttribute(attr.name, value);
	}

	for (let recipe of this.childRecipes) {
	    recipe.renderInto(element, data);
	}

	target.appendChild(element);
    }

    static replacePlaceholders(template: string, data: {}) {
	return template.replace(NodeRecipe.placeholderRegex, function (match, path) {
	    let pieces = path.split('.');
	    let value = resolvePath(pieces, data);
	    if (value != null) {
		return value.toString();
	    }

	    return '';
	});
    }
}

class UnknownHelperError extends Error {
    constructor(name: string) {
	this.message = `Unknown helper '${name}'`;
    }
}

class InvalidTokenError extends Error {
    constructor(token: any) {
	let json = JSON.stringify(token);
	this.message = `Unknown token: ${json}`;
    }
}

class UnexpectedBlockEndError extends Error {
    constructor(saw: string, expected: string) {
	this.message =
            `Unexpected end of block. Saw '${saw}' but expected '${expected}'`;
    }
}

/**
 * Matches placeholders in text. Returns three captured groups in
 * one of two states. In the first state, only group 3 is set. This indicates
 * that no placeholder was found. In the second state, group 1 is set to
 * the text before the placeholder, and group 2 is set to the text found inside
 * the placeholder.
 */
const PLACEHOLDER_RX = /(.*?){{(.+?)}}|(.+)/g;

function isJQuery(x: any): x is JQuery {
    return x instanceof $;
}

function optimizeRecipes(recipes: Recipe[]) {
    return squashTextRecipes(recipes);
}

/**
 * Combine all adjacent text recipes.
 * @param recipes The recipes to optimize.
 */
function squashTextRecipes(recipes: Recipe[]) {
    let optimized = [];
    let lastTextRecipe = null;
    for (let recipe of recipes) {
	if (lastTextRecipe) {
	    if (recipe instanceof TextRecipe) {
		lastTextRecipe.text += recipe.text;
	    } else {
		optimized.push(lastTextRecipe);
		optimized.push(recipe);
		lastTextRecipe = null;
	    }
	} else if (recipe instanceof TextRecipe) {
	    lastTextRecipe = recipe;
	} else {
	    optimized.push(recipe);
	}
    }

    return optimized;
}

function hasLength(x: any): x is any[] {
    return x && x.length;
}

function tokensToRecipes(tokens: Token[]) {
    let state = new ParseState(tokens);
    return state.parseToEnd();
}

/**
 * Given an array of property names, traverse them on
 * the given data and return the final value. The special
 * property name 'this' does no traversal.
 * @param path The path of property names.
 * @param data The data to traverse.
 */
function resolvePath(path: string[], data: {}) {
    for (let piece of path) {
	if (piece !== 'this' && data) {
	    data = data[piece];
	}
    }

    return data;
}

function parseTokens(template: string) {
    let nodes = parseDOM(template);
    return nodesToTokens(nodes);
}

/**
 * Parse a series of nodes into tokens.
 * @param nodes The nodes to parse.
 */
function nodesToTokens(nodes: Node[]) {
    let tokens = [];
    for (let node of nodes) {
	if (node.nodeType === Node.TEXT_NODE) {
	    for (let token of parseTextTokens(node.textContent)) {
		tokens.push(token);
	    }
	} else if (node.nodeType === Node.ELEMENT_NODE) {
	    tokens.push(new NodeToken(node as Element));
	}
    }

    return tokens;
}

function parsePlaceholderToken(text: string): Token {
    switch (text[0]) {
    case '#':
	return new BlockStartToken(text);
    case '/':
	return new BlockEndToken(text);
    default:
	return new FieldToken(text);
    }
}

/**
 * Parse the given text into text, block, and field tokens.
 * @param text The text to parse.
 */
function parseTextTokens(text: string) {
    let result = null;
    let tokens = [];
    while (result = PLACEHOLDER_RX.exec(text)) {
	if (result[3]) {
	    tokens.push(new TextToken(result[3]));
	    continue;
	}

	tokens.push(new TextToken(result[1]));
	tokens.push(parsePlaceholderToken(result[2]));
    }

    PLACEHOLDER_RX.lastIndex = 0;
    return tokens;
}

/**
 * Parse the given raw HTML into a series of nodes.
 * @param rawHTML The raw HTML to parse.
 */
function parseDOM(rawHTML: string) {
    let temp = document.createElement('div');
    temp.innerHTML = rawHTML;
    return slice(temp.childNodes);
}

/**
 * Make a shallow array copy of an array-like object.
 * @param array The object to copy.
 */
function slice<T>(array: ArrayLike<T>): T[] {
    return Array.prototype.slice.call(array);
}
