class FastMold {
    static helpers: HashMap<Helper> = {};
    recipes: Recipe[];
    
    constructor(template: string) {
        let tokens = parseTokens(template);
        this.recipes = tokensToRecipes(tokens);
    }

    render(data: {}) {
        let target = document.createElement('div');
        for (let recipe of this.recipes) {
            recipe.renderInto(target, data);
        }
        
        return target;
    }
}

FastMold.helpers['each'] = {
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

FastMold.helpers['if'] = {
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

FastMold.helpers['with'] = {
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

/*
function isJQuery(x: any): x is JQuery {
    return x instanceof $;
}
*/

function hasLength(x: any): x is any[] {
    return x && x.length;
}

interface HashMap<T> {
    [name: string]: T;
}

interface Helper {
    renderInto(target: Element, data: {}, block: BlockRecipe): void;
}

interface Recipe {
    renderInto(target: Element, data: {}): void;
}

type Token = NodeToken | FieldToken | TextToken | BlockStartToken | BlockEndToken;

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

    endBlock(end: BlockEndToken) {
        let block = this.blockState.pop();
        if (block.name !== end.name) {
            throw new UnexpectedBlockEndError(end);
        }

        this.pushRecipe(block);
    }

    startBlock(block: BlockStartToken) {
        let recipe = new BlockRecipe(block);
        this.blockState.push(recipe);
    }

    atEndOfStream() {
        return this.index >= this.length;
    }

    nextToken() {
        return this.tokens[this.index++];
    }

    parseToEnd() {
        while (!this.atEndOfStream()) {
            let token = this.nextToken();
            if (token instanceof NodeToken) {
                this.pushRecipe(new NodeRecipe(token));
            } else if (token instanceof FieldToken) {
                this.pushRecipe(new FieldRecipe(token));
            } else if (token instanceof TextToken) {
                this.pushRecipe(new TextRecipe(token));
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

    pushRecipe(recipe: Recipe) {
        let length = this.blockState.length;
        if (length) {
            this.blockState[length - 1].pushRecipe(recipe);
        } else {
            this.recipes.push(recipe);
        }
    }
}

function tokensToRecipes(tokens: Token[]) {
    let state = new ParseState(tokens);
    return state.parseToEnd();
}

class TextRecipe implements Recipe {
    text: string;
    constructor(token: TextToken) {
        this.text = token.text;
    }

    renderInto(target: Element, data: {}) {
        target.appendChild(document.createTextNode(this.text));
    }
}

function resolvePath(path: string[], data: {}) {
    for (let piece of path) {
        if (piece !== 'this' && data) {
            data = data[piece];
        }
    }

    return data;
}

class FieldRecipe implements Recipe {
    path: string[];
    constructor(token: FieldToken) {
        this.path = token.path;
    }

    renderInto(target: Element, data: {}) {
        data = resolvePath(this.path, data);
        if (data instanceof Node) {
            target.appendChild(data);
        /*
        } else if (isJQuery(data)) {
            data.each(function (i, el) {
                target.appendChild(el);
            });
        */
        } else if (data != null) {
            target.appendChild(document.createTextNode(data.toString()));
        }
    }
}

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

class BlockRecipe implements Recipe {
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
        this.helper = FastMold.helpers[this.name];
        if (!this.helper) {
            throw new UnknownHelperError(this.name);
        }
    }

    pushRecipe(recipe: Recipe) {
        if (recipe instanceof FieldRecipe
            && recipe.path.length === 1
            && recipe.path[0] === 'else')
        {
            this.currentBranch = this.elseBranch;
            return;
        }

        this.currentBranch.push(recipe);
    }

    renderInto(target: Element, data: {}) {
        this.helper.renderInto(target, data, this);
    }
}

class UnknownHelperError extends Error {
    constructor(name: string) {
        super(`Unknown helper '${name}'`);
    }
}

class InvalidTokenError extends Error {
    constructor(token: any) {
        let json = JSON.stringify(token);
        let message = `Unknown token: ${json}`;
        super(message);
    }
}

class UnexpectedBlockEndError extends Error {
    constructor(token: BlockEndToken) {
        let message = `Unexpected end of block '${token.name}'`;
        super(message);
    }
}

function parseTokens(template: string) {
    let nodes = parseDOM(template);
    return nodesToTokens(nodes);
}

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

interface AttributeRecipe {
    name: string;
    value: string;
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

class BlockStartToken {
    name: string;
    path: string[];
    
    constructor(text: string) {
        let split = text.split(' ');
        this.name = split[0].substr(1);
        this.path = split[1].split('.');
    }
}

class TextToken {
    text: string;

    constructor(text: string) {
        this.text = text;
    }
}

let placeholderRegex = /(.*?){{(.+?)}}|(.+)/g;

function parseTextTokens(text: string) {
    let result = null;
    let tokens = [];
    while (result = placeholderRegex.exec(text)) {
        if (result[3]) {
            tokens.push(new TextToken(result[3]));
            continue;
        }

        tokens.push(new TextToken(result[1]));
        tokens.push(parsePlaceholderToken(result[2]));
    }

    placeholderRegex.lastIndex = 0;
    return tokens;
}

function parseDOM(template: string) {
    let temp = document.createElement('div');
    temp.innerHTML = template;
    return slice(temp.childNodes);
}

function slice<T>(array: ArrayLike<T>): T[] {
    return Array.prototype.slice.call(array);
}

/***************************/

let templateContent = document.getElementById('template').innerHTML;
let template = new FastMold(templateContent);
let data = {
    items: []
};

for (let i = 0; i < 1000; ++i) {
    let item = {
        names: []
    };

    for (let j = 0; j < 1000; ++j) {
        item.names.push(`item ${i}.${j}`);
    }

    data.items.push(item);
}

let button = document.querySelector('button');
button.addEventListener('click', function () {
    let start = new Date();
    let result = template.render(data);
    let end = new Date();
    let diff = end - start;

    alert(`It took ${diff}ms`);
    // document.body.appendChild(result);
});

