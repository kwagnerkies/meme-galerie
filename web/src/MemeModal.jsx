import { useState } from 'react';
import {
  Action,
  ActionGroup,
  Button,
  Content,
  FileField,
  Flex,
  Header,
  Heading,
  IconAttachment,
  IconDelete,
  IconSend,
  Image,
  Label,
  Link,
  Message,
  MessageThread,
  Modal,
  ModalTrigger,
  Section,
  Text,
  TextField,
} from '@mittwald/flow-react-components';
import { api, formatDate, jsonBody } from './api.js';
import { AwardPicker, VoteControl } from './Votes.jsx';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

function Comment({ comment, me, onDelete }) {
  const own = me && comment.author && comment.author.id === me.id;
  return (
    <Message type={own ? 'sender' : 'responder'}>
      <Header>
        <Text>
          <strong>{comment.author ? comment.author.name : 'Unbekannt'}</strong>
        </Text>
        <Text>{formatDate(comment.createdAt)}</Text>
        {own && (
          <Button size="s" variant="plain" color="secondary" aria-label="Kommentar löschen" onPress={() => onDelete(comment)}>
            <IconDelete />
          </Button>
        )}
      </Header>
      <Content>
        {comment.text && <Text>{comment.text}</Text>}
        {comment.file && (
          <Image src={`/uploads/${comment.file}`} alt={comment.text || 'Bild im Kommentar'} withRoundedCorners className="comment-image" />
        )}
      </Content>
    </Message>
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
      <Flex align="end" gap="s" wrap="wrap">
        <TextField value={text} onChange={setText} maxLength={500} className="grow">
          <Label>Kommentar</Label>
        </TextField>
        <FileField accept={ACCEPT} onChange={(files) => setFile(files?.[0] || null)}>
          <Button variant={file ? 'soft' : 'outline'} color={file ? 'primary' : 'secondary'} aria-label={file ? `Bild angehängt: ${file.name}` : 'Bild anhängen'}>
            <IconAttachment />
          </Button>
        </FileField>
        <Button type="submit" isPending={pending} aria-label="Kommentar senden">
          <IconSend />
        </Button>
      </Flex>
      {file && <Text className="muted">Angehängt: {file.name}</Text>}
    </form>
  );
}

function RenameForm({ meme, onChanged, onError }) {
  const [name, setName] = useState(meme.name);
  const [pending, setPending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    try {
      onChanged(await api(`/api/memes/${meme.id}`, { method: 'PATCH', ...jsonBody({ name }) }));
    } catch (err) {
      onError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Flex align="end" gap="s">
        <TextField value={name} onChange={setName} maxLength={120} isRequired className="grow">
          <Label>Name</Label>
        </TextField>
        <Button type="submit" variant="soft" color="secondary" isPending={pending} isDisabled={name.trim() === meme.name}>
          Umbenennen
        </Button>
      </Flex>
    </form>
  );
}

function DetailContent({ meme, me, awardTypes, onVote, onAward, onChanged, onError }) {
  const date = formatDate(meme.createdAt);
  const meta = meme.uploadedBy ? `Hochgeladen von ${meme.uploadedBy.name} am ${date}` : `Hochgeladen am ${date}`;

  const deleteComment = async (comment) => {
    try {
      onChanged(await api(`/api/memes/${meme.id}/comments/${comment.id}`, { method: 'DELETE' }));
    } catch (err) {
      onError(err);
    }
  };

  return (
    <>
      <Section>
        <Image src={`/uploads/${meme.file}`} alt={meme.name} withRoundedCorners className="detail-image" />
        <Flex align="center" justify="space-between" wrap="wrap" gap="m">
          <Text className="muted">{meta}</Text>
          <VoteControl meme={meme} onVote={onVote} />
        </Flex>
        <AwardPicker meme={meme} awardTypes={awardTypes} onAward={onAward} />
      </Section>
      <Section>
        <Heading>Kommentare</Heading>
        {meme.comments?.length ? (
          <MessageThread>
            {meme.comments.map((c) => (
              <Comment key={c.id} comment={c} me={me} onDelete={deleteComment} />
            ))}
          </MessageThread>
        ) : (
          <Text className="muted">Noch keine Kommentare.</Text>
        )}
        <CommentForm meme={meme} onChanged={onChanged} onError={onError} />
      </Section>
      <Section>
        <Heading>Bearbeiten</Heading>
        <RenameForm key={meme.id + meme.name} meme={meme} onChanged={onChanged} onError={onError} />
      </Section>
    </>
  );
}

export default function MemeModal({ controller, meme, onDeleted, onError, ...props }) {
  const download = meme && meme.name + meme.file.slice(meme.file.lastIndexOf('.'));

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
    <Modal controller={controller} size="l">
      <Heading>{meme?.name}</Heading>
      <Content>{meme && <DetailContent meme={meme} onError={onError} {...props} />}</Content>
      <ActionGroup>
        <Link href={meme ? `/uploads/${meme.file}` : undefined} download={download}>
          Herunterladen
        </Link>
        <ModalTrigger>
          <Button color="danger" variant="soft">
            Löschen
          </Button>
          <Modal size="s">
            <Heading>Meme löschen?</Heading>
            <Content>
              <Text>
                „{meme?.name}“ wird mit allen Kommentaren gelöscht. Das lässt sich nicht rückgängig machen.
              </Text>
            </Content>
            <ActionGroup>
              <Action closeModal onAction={remove}>
                <Button color="danger">Löschen</Button>
              </Action>
              <Action closeModal>
                <Button variant="soft" color="secondary">
                  Abbrechen
                </Button>
              </Action>
            </ActionGroup>
          </Modal>
        </ModalTrigger>
        <Action closeModal>
          <Button variant="soft" color="secondary">
            Schließen
          </Button>
        </Action>
      </ActionGroup>
    </Modal>
  );
}
