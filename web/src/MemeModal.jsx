import { useState } from 'react';
import {
  Action,
  ActionGroup,
  Button,
  Content,
  ContextMenu,
  ContextMenuTrigger,
  FileField,
  Flex,
  Heading,
  IconAttachment,
  IconContextMenu,
  IconDelete,
  IconDownload,
  IconEdit,
  IconFeedback,
  IconSend,
  Image,
  Label,
  MenuItem,
  Modal,
  Text,
  TextField,
  useModalController,
} from '@mittwald/flow-react-components';
import { api, formatDate, jsonBody } from './api.js';
import { VoteControl } from './Votes.jsx';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

function download(meme) {
  const a = document.createElement('a');
  a.href = `/uploads/${meme.file}`;
  a.download = meme.name + meme.file.slice(meme.file.lastIndexOf('.'));
  a.click();
}

// Reddit-like comment: author and time in one small line, text below, no chat bubbles
function Comment({ comment, me, onDelete }) {
  const own = me && comment.author && comment.author.id === me.id;
  return (
    <li className="comment">
      <Flex align="center" gap="s">
        <Text className="comment-author">{comment.author ? comment.author.name : 'Unbekannt'}</Text>
        <Text className="muted comment-time">{formatDate(comment.createdAt)}</Text>
        {own && (
          <Button size="s" variant="plain" color="secondary" aria-label="Kommentar löschen" onPress={() => onDelete(comment)}>
            <IconDelete />
          </Button>
        )}
      </Flex>
      {comment.text && <Text elementType="p">{comment.text}</Text>}
      {comment.file && (
        <Image src={`/uploads/${comment.file}`} alt={comment.text || 'Bild im Kommentar'} className="comment-image" loading="lazy" />
      )}
    </li>
  );
}

function CommentForm({ meme, onChanged, onError }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() && !file) return;
    setPending(true);
    try {
      const headers = { 'X-Comment-Text': encodeURIComponent(text.trim()) };
      if (file) headers['Content-Type'] = file.type;
      onChanged(await api(`/api/memes/${meme.id}/comments`, { method: 'POST', headers, body: file }));
      setText('');
      setFile(null);
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Flex align="center" gap="s">
        <TextField value={text} onChange={setText} maxLength={500} aria-label="Kommentar" placeholder="Kommentar schreiben …" className="grow" />
        <FileField accept={ACCEPT} onChange={(files) => setFile(files?.[0] || null)}>
          <Button
            variant={file ? 'soft' : 'plain'}
            color={file ? 'primary' : 'secondary'}
            aria-label={file ? `Bild angehängt: ${file.name}` : 'Bild anhängen'}
          >
            <IconAttachment />
          </Button>
        </FileField>
        <Button type="submit" isPending={pending} aria-label="Kommentar senden">
          <IconSend />
        </Button>
      </Flex>
    </form>
  );
}

function RenameModal({ controller, meme, onChanged, onError }) {
  const [name, setName] = useState(meme.name);

  const save = async () => {
    try {
      onChanged(await api(`/api/memes/${meme.id}`, { method: 'PATCH', ...jsonBody({ name }) }));
    } catch (err) {
      onError(err);
    }
  };

  return (
    <Modal controller={controller} size="s">
      <Heading>Meme umbenennen</Heading>
      <Content>
        <TextField value={name} onChange={setName} maxLength={120} isRequired autoFocus>
          <Label>Name</Label>
        </TextField>
      </Content>
      <ActionGroup>
        <Action closeModal onAction={save}>
          <Button isDisabled={!name.trim() || name.trim() === meme.name}>Speichern</Button>
        </Action>
        <Action closeModal>
          <Button variant="soft" color="secondary">
            Abbrechen
          </Button>
        </Action>
      </ActionGroup>
    </Modal>
  );
}

function DeleteModal({ controller, meme, onConfirm }) {
  return (
    <Modal controller={controller} size="s">
      <Heading>Meme löschen?</Heading>
      <Content>
        <Text>„{meme.name}“ wird mit allen Kommentaren gelöscht. Das lässt sich nicht rückgängig machen.</Text>
      </Content>
      <ActionGroup>
        <Action closeModal onAction={onConfirm}>
          <Button color="danger">Löschen</Button>
        </Action>
        <Action closeModal>
          <Button variant="soft" color="secondary">
            Abbrechen
          </Button>
        </Action>
      </ActionGroup>
    </Modal>
  );
}

function Post({ meme, me, onVote, onChanged, onError, onRename, onDelete }) {
  const count = meme.comments?.length || 0;
  const by = meme.uploadedBy ? `${meme.uploadedBy.name} · ` : '';

  const deleteComment = async (comment) => {
    try {
      onChanged(await api(`/api/memes/${meme.id}/comments/${comment.id}`, { method: 'DELETE' }));
    } catch (err) {
      onError(err);
    }
  };

  return (
    <Flex direction="column" gap="m">
      <Text className="muted post-meta">
        {by}
        {formatDate(meme.createdAt)}
      </Text>

      <div className="post-image">
        <Image src={`/uploads/${meme.file}`} alt={meme.name} withRoundedCorners={false} />
      </div>

      <Flex align="center" gap="s" wrap="wrap">
        <VoteControl meme={meme} onVote={onVote} />
        <Flex align="center" gap="xs" className="muted">
          <IconFeedback size="s" />
          <Text>{count === 1 ? '1 Kommentar' : `${count} Kommentare`}</Text>
        </Flex>
        <Flex grow />
        <Button size="s" variant="plain" color="secondary" aria-label="Herunterladen" onPress={() => download(meme)}>
          <IconDownload />
        </Button>
        <ContextMenuTrigger>
          <Button size="s" variant="plain" color="secondary" aria-label="Weitere Aktionen">
            <IconContextMenu />
          </Button>
          <ContextMenu>
            <MenuItem onAction={onRename}>
              <IconEdit />
              <Text>Umbenennen</Text>
            </MenuItem>
            <MenuItem onAction={onDelete}>
              <IconDelete />
              <Text>Löschen</Text>
            </MenuItem>
          </ContextMenu>
        </ContextMenuTrigger>
      </Flex>

      <CommentForm meme={meme} onChanged={onChanged} onError={onError} />
      {count > 0 && (
        <ul className="comments">
          {meme.comments.map((c) => (
            <Comment key={c.id} comment={c} me={me} onDelete={deleteComment} />
          ))}
        </ul>
      )}

    </Flex>
  );
}

// Rename and delete dialogs sit next to the detail modal, not inside it: a Modal nested in another
// Modal's content made every click into the detail modal count as "outside" and close it.
export default function MemeModal({ controller, meme, onDeleted, onError, ...props }) {
  const renameModal = useModalController();
  const deleteModal = useModalController();

  const remove = async () => {
    try {
      await api(`/api/memes/${meme.id}`, { method: 'DELETE' });
      controller.close();
      onDeleted(meme.id);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <Modal controller={controller} size="s" showCloseButton>
        <Heading>{meme?.name}</Heading>
        <Content>
          {meme && (
            <Post meme={meme} onError={onError} onRename={() => renameModal.open()} onDelete={() => deleteModal.open()} {...props} />
          )}
        </Content>
      </Modal>
      {meme && <RenameModal key={meme.id + meme.name} controller={renameModal} meme={meme} onChanged={props.onChanged} onError={onError} />}
      {meme && <DeleteModal controller={deleteModal} meme={meme} onConfirm={remove} />}
    </>
  );
}
