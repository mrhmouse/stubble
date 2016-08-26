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
    (e: Element, token: Token, tokens: Token[]): void;
}

interface HelperEntry {
    name: string;
    helper: Helper;
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

    private static findHelper(name: string): Helper {
        let firstWord = name.split(' ')[0];
        for (let entry of Template.helpers) {
            if (entry.name === firstWord) {
                return entry.helper;
            }
        }

        return null;
    }

    private resolve(e: Element, data: {}) {
        if (e.attributes && e.attributes.length) {
            this.resolveAttributes(e, data);
        }

        let tokens = this.parse(e, data);
        Template.clearNode(e);
        while (tokens.length) {
            this.handleNextToken(e, tokens);
        }
    }

    private static clearNode(e: Node) {
        while (e.childNodes.length) {
            e.removeChild(e.childNodes[0]);
        }
    }

    private handleNextToken(e: Element, tokens: Token[]) {
        let token = tokens.shift();
        switch (token.type) {
        case 'text':
            e.appendChild(document.createTextNode(token.text));
            break;
            
        case 'field':
            if (token.field[0] === '#') {
                let helper = Template.findHelper(token.field.substr(1));
                if (helper) {
                    helper(e, token, tokens);
                }
            } else {
                let field = token.data;
                for (let name of token.field.split('.')) {
                    if (field == null) break;
                    field = field[name];
                }

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
            this.resolve(token.node, token.data);
            break;
        }
    }

    private parse(e: Element, data: {}): Token[] {
        let nodes = Array.prototype.slice.call(e.childNodes);
        let tokens = [];
        for (let node of nodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                let re = /(.*?){{(.+?)}}/ig;
                let text = node.textContent;
                let results = [];
                while (results = re.exec(text)) {
                    text = text.substr(re.lastIndex);
                    re.lastIndex = 0;
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

    private resolveAttributes(e: Element, data: {}) {
        let attributes = Array.prototype.slice.call(e.attributes);
        for (let attr of attributes) {
            e.setAttribute(
                attr.name,
                Template.replaceText(e.getAttribute(attr.name), data));
        }
    }

    static replaceText(template: string, data: {}): string {
        return template.replace(/{{(\S+)}}/ig, (match, path) => {
            let field = data;
            for (let name of path.split('.')) {
                field = field[name];
            }

            if (field != null) return field.toString();
            return '';
        });
    }
}

Template.registerHelper('foo', (e, t, ts) => {
    e.appendChild(document.createTextNode('FOOOOO'));
});

let blurb = new Template($('#blurb').html());
$('body').append(blurb.render({
    color: 'red',
    header: 'test',
    blurb: 'I\'m <b>escaped</b>',
    otherBlurb: $($('#other').html())
}));
