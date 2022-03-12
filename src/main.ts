/* eslint-disable import/no-extraneous-dependencies */
import * as Y from 'yjs';
import { assert, createEditor } from '@nexteditorjs/nexteditor-core';
import TableBlock from '@nexteditorjs/nexteditor-table-block';
import { EnforceWithDocumentTitleHandler, MarkdownInputHandler } from '@nexteditorjs/nexteditor-input-handlers';
import { WebsocketProvider } from 'y-websocket';
import './style.css';
import YjsDoc from './yjs-doc/yjs-doc';

const yDoc = new Y.Doc();

// Sync clients with the y-websocket provider
const websocketProvider = new WebsocketProvider('ws://localhost:4000', 'yjs-demo-11', yDoc);

const app = document.querySelector<HTMLDivElement>('#app');
assert(app, 'app does not exists');

let loaded = false;

yDoc.on('update', (update: any, origin: any, doc: any) => {
  console.log(origin, doc);
  if (!loaded) {
    loaded = true;
    const editor = createEditor(app, new YjsDoc(yDoc), {
      components: {
        blocks: [TableBlock],
      },
    });
    editor.input.addHandler(new MarkdownInputHandler());
    editor.input.addHandler(new EnforceWithDocumentTitleHandler(editor, {
      headingLevel: 1,
      titlePlaceholder: 'Yjs demo',
      contentPlaceholder: 'Enter some text...',
    }));
    (window as any).editor = editor;
  }
});

websocketProvider.on('status', (event: any) => {
  if (event.status === 'connected') {
    console.log('connected', yDoc);
  }
});
