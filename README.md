# Stubble
Stubble is a templating language for the browser, based loosely on Mustache's syntax.

## Differences from Mustache
* Uses DOM-based templates, not strings
* No scope traversal via `../`, but this may be added later
* Helpers must be explicitly named, e.g. `{{#each foo}}{{/each}}` instead of `{{#foo}}{{/foo}}`
* No triple-curly, e.g. `{{{foo}}}`, for raw HTML

# Data Types
Stubble recognizes the following types of data:
* Array-like objects
* `Node` and its descendants
* `JQuery` objects
* Everything else

## Data Types: Array-like Objects
Array-like objects (that is, objects with a `length` property) can be iterated
over using a built-in helper, `each`.

## Data Types: Node and JQuery
Instances of `Node` and `JQuery` are inserted into the rendered result directly. This means
that you can attach event-handlers, JQuery data, etc., and still make use of
it after wrapping the object in a template. This is the primary motivation for Stubble.

## Data Types: Everything Else
All other data types are stringified via their `.toString()` method, and then
inserted into the rendered result as a text node. This means that all data is HTML-encoded
automatically.
