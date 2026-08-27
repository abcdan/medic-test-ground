import { useEffect, useRef, useState } from "react";
import { Button } from "./primitives";
import { useDebounce } from "../hooks/useDebounce";

const TOOLBAR: { command: string; label: string; title: string }[] = [
  { command: "bold", label: "B", title: "Bold" },
  { command: "italic", label: "I", title: "Italic" },
  { command: "underline", label: "U", title: "Underline" },
  { command: "insertUnorderedList", label: "•", title: "Bullet list" },
  { command: "insertOrderedList", label: "1.", title: "Numbered list" },
];

/**
 * Rich text notes editor.
 *
 * Content is stored as HTML. Autosaves after the user stops typing.
 */
export function NotesEditor({
  value,
  onSave,
  placeholder = "Add a note…",
}: {
  value: string;
  onSave: (html: string) => void;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(value);
  const [dirty, setDirty] = useState(false);
  const debounced = useDebounce(html, 1200);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  useEffect(() => {
    if (dirty) {
      onSave(debounced);
      setDirty(false);
    }
  }, [debounced]);

  const exec = (command: string) => {
    document.execCommand(command, false);
    editorRef.current?.focus();
    handleInput();
  };

  const handleInput = () => {
    const next = editorRef.current?.innerHTML ?? "";
    setHtml(next);
    setDirty(true);
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const text = event.clipboardData.getData("text/html") || event.clipboardData.getData("text/plain");
    event.preventDefault();
    document.execCommand("insertHTML", false, text);
    handleInput();
  };

  return (
    <div className="notes-editor">
      <div className="notes-editor__toolbar">
        {TOOLBAR.map((item) => (
          <button key={item.command} title={item.title} onClick={() => exec(item.command)}>
            {item.label}
          </button>
        ))}
        <span className="notes-editor__status">{dirty ? "unsaved" : "saved"}</span>
      </div>

      <div
        ref={editorRef}
        className="notes-editor__surface"
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={handleInput}
        onPaste={handlePaste}
        suppressContentEditableWarning
      />

      <div className="notes-editor__footer">
        <Button variant="primary" onClick={() => onSave(html)} disabled={!dirty}>
          Save now
        </Button>
      </div>
    </div>
  );
}

/** Read-only render of stored note HTML. */
export function NotesPreview({ html }: { html: string }) {
  return <div className="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
