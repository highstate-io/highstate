import { Marked } from "marked"
import { markedHighlight } from "marked-highlight"
import hljs from "highlight.js"
import DOMPurify from "dompurify"

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext"
      return hljs.highlight(code, { language }).value
    },
  }),
)

export function renderMarkdown(content: string): string {
  return DOMPurify.sanitize(marked.parse(content, { async: false }))
}
