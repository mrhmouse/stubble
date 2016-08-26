type Token = TextToken | NodeToken | FieldToken;

interface TextToken {
    type: 'text';
    text: string;
}

interface NodeToken {
    type: 'node';
    node: Node;
    data: {};
}

interface FieldToken {
    type: 'field';
    field: string;
    data: {};
}

interface Helper {
    (e: Element, template: Template, tokens: Token[], data: {}): void;
}

interface HelperEntry {
    name: string;
    helper: Helper;
}

function resolvePath(data: {}, path: string) {
    for (let name of path.split('.')) {
        if (data == null) break;
        data = data[name];
    }

    return data;
}

class Template {
    private element: JQuery;
    private static helpers: HelperEntry[] = [];

    constructor(template: string) {
        this.element = $(template);
    }

    render(data: {}): JQuery {
        let result = this.element.clone();
        result.each((i, e) => {
            this.resolve(e, data);
        });

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

    resolve(e: Element, data: {}) {
        if (e.attributes && e.attributes.length) {
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

    handleNextToken(e: Element, tokens: Token[], data: {}) {
        let token = tokens.shift();
        switch (token.type) {
        case 'text':
            e.appendChild(document.createTextNode(token.text));
            break;
            
        case 'field':
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
                } else if (field instanceof $) {
                    field.appendTo(e);
                } else if (field != null) {
                    e.appendChild(document.createTextNode(field.toString()));
                }
            }
            break;
            
        case 'node':
            e.appendChild(token.node);
            this.resolve(token.node, data);
            break;
        }
    }

    parse(e: Element, data: {}): Token[] {
        let nodes = Array.prototype.slice.call(e.childNodes);
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
        let attributes = Array.prototype.slice.call(e.attributes);
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

Template.registerHelper('each', (e, template, ts, data) => {
    let t = ts.shift();
    let loop = collectBlock(ts, 'each');
    let field = resolvePath(data, t.field.substr('#each '.length));
    if (field == null || !field.length) {
        while (loop.second.length) {
            template.handleNextToken(e, loop.second, data);
        }
    } else {
        for (let item of field) {
            let copy = loop.first.slice();
            while (copy.length) {
                template.handleNextToken(e, copy, item);
            }
        }
    }
});

interface Block {
    /** The tokens appearing between delimiters, before the {{else}} */
    first: Token[];

    /** The tokens after the {{else}} */
    second: Token[];
}

function collectBlock(tokens: Token[], name: string): Token[] {
    let result = {
        first: [],
        second: []
    };
    
    let depth = 1;
    let block = result.first;
    let start = '#' + name;
    let end = '/' + name;
    
    while (tokens.length) {
        let token = tokens.shift();
        if (token.type === 'field') {
            if (token.field === end) {
                if (--depth === 0) {
                    break;
                }
            } else if (0 === token.field.indexOf(start)) {
                depth++;
            } else if (token.field === 'else' && depth === 1) {
                block = result.second;
            }
        }

        block.push(token);
    }

    return result;
}

Template.registerHelper('with', (element, template, tokens, data) => {
    let withToken = tokens.shift();
    let newContext = resolvePath(data, withToken.field.substr('#with '.length));
    let block = collectBlock(tokens, 'with');
    let choice = newContext ? block.first : block.second;
    while (choice.length) {
        template.handleNextToken(element, choice, newContext);
    }
});

Template.registerHelper('if', (element, template, tokens, data) => {
    let ifToken = tokens.shift();
    let result = resolvePath(data, ifToken.field.substr('#if '.length));
    let block = collectBlock(tokens, 'if');
    let branch = result ? block.first : block.second;
    while (branch.length) {
        template.handleNextToken(element, branch, data);
    }

});

let blurb = new Template($('#blurb').html());
$('body').append(blurb.render({
    test: true,
    nested: {
        foo: {
            names: [
                { name: "Bob" },
                { name: "Ken" }
            ]
        }
    }
}));
