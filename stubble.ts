import $ = require('jquery');

export class Template {
    private nodes: Node[];
    private static helpers: HelperEntry[] = [];

    constructor(template: string) {
        let temp = document.createElement('div');
        temp.innerHTML = template;
        this.nodes = slice<Node>(temp.childNodes);
    }

    render(data: {}): JQuery {
        let result = $('<div>');
        for (let node of this.nodes) {
            let child = node.cloneNode(true);
            this.resolve(child, data);
            result.append($(child));
        }

        result = result.contents();
        return result;
    }

    static registerHelper(name: string, helper: Helper) {
        Template.helpers.unshift({
            name: name,
            helper: helper
        });
    }

    static findHelper(name: string): Helper {
        let firstWord = name.split(' ')[0];
        for (let entry of Template.helpers) {
            if (entry.name === firstWord) {
                return entry.helper;
            }
        }

        return null;
    }

    resolve(e: Node, data: {}) {
        if (e instanceof Element && e.attributes.length) {
            this.resolveAttributes(e, data);
        }

        let tokens = this.parse(e, data);
        Template.clearNode(e);
        while (tokens.length) {
            this.handleNextToken(e, tokens, data);
        }
    }

    static clearNode(e: Node) {
        while (e.childNodes.length) {
            e.removeChild(e.childNodes[0]);
        }
    }

    handleNextToken(e: Node, tokens: Token[], data: {}) {
        let token = tokens.shift();
        if (isText(token)) {
            e.appendChild(document.createTextNode(token.text));
        } else if (isField(token)) {
            if (token.field[0] === '#') {
                let helper = Template.findHelper(token.field.substr(1));
                if (helper) {
                    tokens.unshift(token);
                    helper(e, this, tokens, data);
                }
            } else {
                let field = resolvePath(data, token.field);
                if (field instanceof Node) {
                    e.appendChild(field);
                } else if (isJQuery(field)) {
                    $(e).append(field);
                } else if (field != null) {
                    e.appendChild(document.createTextNode(field.toString()));
                }
            }
        } else if (isNode(token)) {
            e.appendChild(token.node);
            this.resolve(token.node, data);
        }
    }

    parse(e: Node, data: {}): Token[] {
        let nodes = slice<Node>(e.childNodes);
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

    resolveAttributes(e: Element, data: {}) {
        let attributes = slice<Attr>(e.attributes);
        for (let attr of attributes) {
            e.setAttribute(
                attr.name,
                Template.replaceText(e.getAttribute(attr.name), data));
        }
    }

    static replaceText(template: string, data: {}): string {
        return template.replace(/{{(\S+)}}/ig, (match, path) => {
            let field = resolvePath(data, path);
            if (field != null) return field.toString();
            return '';
        });
    }
}

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

export interface Helper {
    (e: Node, template: Template, tokens: Token[], data: {}): void;
}

export function resolvePath(data: {}, path: string) {
    for (let name of path.split('.')) {
        if (data == null) break;
        data = data[name];
    }

    return data;
}

export interface Block {
    /** The tokens appearing between delimiters, before the {{else}} */
    first: Token[];

    /** The tokens after the {{else}} */
    second: Token[];
}

export function collectBlock(tokens: Token[]): Block {
    let result = {
        first: [],
        second: []
    };

    let depth = 1;
    let block = result.first;

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
                block = result.second;
                continue;
            }
        }

        block.push(token);
    }

    return result;
}

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

Template.registerHelper('with', (element, template, tokens, data) => {
    let withToken = (<FieldToken>tokens.shift());
    let newContext = resolvePath(data, withToken.field.substr('#with '.length));
    let block = collectBlock(tokens);
    let choice = newContext ? block.first : block.second;
    while (choice.length) {
        template.handleNextToken(element, choice, newContext);
    }
});

Template.registerHelper('if', (element, template, tokens, data) => {
    let ifToken = (<FieldToken>tokens.shift());
    let result = resolvePath(data, ifToken.field.substr('#if '.length));
    let block = collectBlock(tokens);
    let branch = result ? block.first : block.second;
    while (branch.length) {
        template.handleNextToken(element, branch, data);
    }
});

Template.registerHelper('each', (element, template, tokens, data) => {
    let token = (<FieldToken>tokens.shift());
    let loop = collectBlock(tokens);
    let field = resolvePath(data, token.field.substr('#each '.length));
    if (hasLength(field)) {
        for (let item of field) {
            let copy = cloneTokens(loop.first);
            while (copy.length) {
                template.handleNextToken(element, copy, item);
            }
        }
    } else {
        while (loop.second.length) {
            template.handleNextToken(element, loop.second, data);
        }
    }
});

interface HelperEntry {
    name: string;
    helper: Helper;
}

function hasLength(x: any): x is any[] {
    return x != null && x.length;
}

function isJQuery(x: any): x is JQuery {
    return x instanceof $;
}

function slice<T>(x: any): T[] {
    return Array.prototype.slice.call(x);
}
