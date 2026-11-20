// apps/frontend/src/components/RichTextEditor.tsx
// NetAmplify — Rich text editor built on Tiptap v3.
//
// Replaces the plain <Textarea> in PostCardComposer with a WYSIWYG editor
// matching postiz's editing experience: toolbar with Bold, Italic, Underline,
// Strikethrough, H1, H2, H3, Bullet List, Ordered List, Blockquote, Code
// Block, Link, and Undo/Redo.
//
// The stored format is MARKDOWN (not HTML) — the editor converts HTML↔markdown
// via the markdown-converter module. This means the Format Engine, all
// platform adapters, and the stored PostCard.description field are unchanged.
//
// Props match the textarea interface: { value: string (markdown),
// onChange: (markdown: string) => void, maxLength?: number, placeholder?:
// string }.

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  useEffect,
  useRef,
  useCallback,
  type ForwardedRef,
} from 'react';
import { markdownToHtml, htmlToMarkdown } from '@/lib/markdown-converter';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code2,
  Link as LinkIcon,
  Undo2,
  Redo2,
} from 'lucide-react';

interface RichTextEditorProps {
  /** Current markdown content (controlled component). */
  value: string;
  /** Called with new markdown whenever the editor content changes. */
  onChange: (markdown: string) => void;
  /** Maximum character count (markdown length). Shows a counter. */
  maxLength?: number;
  /** Placeholder text shown when the editor is empty. */
  placeholder?: string;
  /** Ref forwarded to the editor's root div (for focus, etc.). */
  ref?: ForwardedRef<HTMLDivElement>;
}

/**
 * A single toolbar button. Active state is driven by the Tiptap editor's
 * `isActive` check (e.g. `editor.isActive('bold')`).
 */
function ToolbarButton({
  editor,
  onClick,
  isActive,
  disabled,
  title,
  children,
}: {
  editor: Editor | null;
  onClick: () => void;
  isActive: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // prevent losing editor focus
      onClick={onClick}
      disabled={disabled || !editor}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        isActive
          ? 'bg-indigo-500/30 text-indigo-300'
          : 'text-white/50 hover:bg-white/10 hover:text-white'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

/**
 * The toolbar — rendered above the editor content area. All buttons operate
 * on the Tiptap editor via `editor.chain().focus()...run()`.
 */
function Toolbar({ editor }: { editor: Editor | null }) {
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string;
    const url = window.prompt('Enter URL:', previousUrl ?? 'https://');
    // Cancel → keep existing link.
    if (url === null) return;
    // Empty → remove link.
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run();
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().undo().run()}
        isActive={false}
        disabled={!editor?.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().redo().run()}
        isActive={false}
        disabled={!editor?.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor?.isActive('heading', { level: 1 }) ?? false}
        title="Heading 1"
      >
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor?.isActive('heading', { level: 2 }) ?? false}
        title="Heading 2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor?.isActive('heading', { level: 3 }) ?? false}
        title="Heading 3"
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
        isActive={editor?.isActive('bold') ?? false}
        title="Bold (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        isActive={editor?.isActive('italic') ?? false}
        title="Italic (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
        isActive={editor?.isActive('underline') ?? false}
        title="Underline (Ctrl+U)"
      >
        <Underline className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
        isActive={editor?.isActive('strike') ?? false}
        title="Strikethrough"
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        isActive={editor?.isActive('bulletList') ?? false}
        title="Bullet List"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        isActive={editor?.isActive('orderedList') ?? false}
        title="Numbered List"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        isActive={editor?.isActive('blockquote') ?? false}
        title="Quote"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        editor={editor}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        isActive={editor?.isActive('codeBlock') ?? false}
        title="Code Block"
      >
        <Code2 className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <ToolbarButton
        editor={editor}
        onClick={setLink}
        isActive={editor?.isActive('link') ?? false}
        title="Insert Link"
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
    </div>
  );
}

/**
 * The RichTextEditor component. Uses Tiptap v3 with StarterKit (which
 * bundles Bold, Italic, Underline, Strike, Heading, BulletList, OrderedList,
 * ListItem, Code, CodeBlock, Blockquote, HorizontalRule, HardBreak, History)
 * + the Link extension.
 *
 * Content flow:
 *   - value (markdown) → markdownToHtml → Tiptap content (HTML)
 *   - User edits in WYSIWYG
 *   - editor.getHTML() → htmlToMarkdown → onChange(markdown)
 *
 * The stored format is always markdown — the Format Engine + adapters are
 * unchanged.
 */
export function RichTextEditor({
  value,
  onChange,
  maxLength,
  placeholder = 'Start writing...',
}: RichTextEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: 'text-indigo-400 underline',
        },
      }),
    ],
    content: markdownToHtml(value),
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      onChangeRef.current(md);
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-invert prose-sm max-w-none min-h-[12rem] px-4 py-3 ' +
          'focus:outline-none text-white placeholder:text-white/30 ' +
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ' +
          '[&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-white/60 ' +
          '[&_pre]:bg-black/30 [&_pre]:rounded [&_pre]:p-3 [&_pre_code]:text-sm ' +
          '[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-semibold ' +
          '[&_a]:text-indigo-400 [&_a]:underline',
        'data-placeholder': placeholder,
      },
    },
  });

  // When the `value` prop changes externally (e.g. loading an existing
  // PostCard), update the editor content. Guard against updating from
  // the editor's own onChange (which would cause a loop).
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (editor && value !== lastValueRef.current) {
      lastValueRef.current = value;
      const currentMd = htmlToMarkdown(editor.getHTML());
      if (currentMd !== value) {
        editor.commands.setContent(markdownToHtml(value));
      }
    }
  }, [value, editor]);

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-white/5 backdrop-blur">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="tiptap-editor" />
      {maxLength !== undefined && (
        <div className="border-t border-white/10 px-4 py-1.5 text-right text-xs text-white/30">
          {value.length}/{maxLength}
        </div>
      )}
    </div>
  );
}

export default RichTextEditor;
