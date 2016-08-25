class Template {
    private element: JQuery;

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

    private resolve(e: Element, data: {}) {
        if (e.attributes && e.attributes.length) {
            this.resolveAttributes(e, data);
        }

        this.resolveTextNodes(e, data);
        this.resolveChildren(e, data);
    }

    private resolveAttributes(e: Element, data: {}) {
        for (let attr of e.attributes) {
            e.setAttribute(
                attr.name,
                Template.replaceText(e.getAttribute(attr.name), data));
        }
    }

    private resolveTextNodes(e: Element, data: {}) {
        let nodes = Array.prototype.slice.call(e.childNodes);
        for (let node of nodes) {
            if (node.nodeType !== Node.TEXT_NODE) continue;
            let re = /(.*?){{(\S+)}}/ig;
            let text = node.textContent;
            let results = [];

            while (results = re.exec(text)) {
                text = text.substr(re.lastIndex);
                e.insertBefore(document.createTextNode(results[1]), node);
                let field = data;
                // TODO helpers, e.g. #each or #with or #if
                for (let name of results[2].split('.')) {
                    if (!field) break;
                    field = field[name];
                }

                if (field != null) {
                    let element = null;
                    if (field instanceof Element) {
                        element = field;
                    } else if (field instanceof $) {
                        element = field[0];
                    } else {
                        element = document.createTextNode(field.toString());
                    }

                    e.insertBefore(element, node);
                }
            }

            e.insertBefore(document.createTextNode(text), node);
            e.removeChild(node);
        }
    }

    private resolveChildren(e: Element, data: {}) {
        for (let node of e.childNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            this.resolve(node, data);
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
