/* eslint-disable import/no-extraneous-dependencies */
import { assert, createEditor } from '@nexteditorjs/nexteditor-core';
import TableBlock from '@nexteditorjs/nexteditor-table-block';
import ListBlock from '@nexteditorjs/nexteditor-list-block';
import { EnforceWithDocumentTitleHandler, MarkdownInputHandler } from '@nexteditorjs/nexteditor-input-handlers';
import './style.css';
import YjsDoc from './yjs-doc/yjs-doc';
import { ErrorType } from './yjs-doc/options';

const app = document.querySelector<HTMLDivElement>('#app');
assert(app, 'app does not exists');

const handleDocError = (type: ErrorType, error: unknown) => {
  console.error(`${type} error, ${error}`);
};

YjsDoc.load({
  server: 'ws://localhost:4000',
  documentId: 'yjs-demo-11',
  onDocError: handleDocError,
}).then((doc) => {
  const editor = createEditor(app, doc, {
    components: {
      blocks: [TableBlock, ListBlock],
    },
  });
  editor.input.addHandler(new MarkdownInputHandler());
  editor.input.addHandler(new EnforceWithDocumentTitleHandler(editor, {
    headingLevel: 1,
    titlePlaceholder: 'Yjs demo',
    contentPlaceholder: 'Enter some text...',
  }));
  (window as any).editor = editor;
});
