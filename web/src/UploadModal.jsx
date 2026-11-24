import { useEffect, useState } from 'react';
import {
  Action,
  ActionGroup,
  AlertText,
  Button,
  Content,
  FileDropZone,
  FileField,
  Heading,
  IconImage,
  Image,
  Label,
  Modal,
  Section,
  Text,
  TextField,
} from '@mittwald/flow-react-components';
import { api } from './api.js';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
const nameFromFile = (file) => file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

export default function UploadModal({ controller, initialFile, onUploaded }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const pick = (picked) => {
    if (!picked || !picked.type.startsWith('image/')) return;
    setFile(picked);
    setError(null);
    setName((current) => current || nameFromFile(picked));
  };

  // A pasted image arrives from the page; start every opening with a clean form
  controller.useOnClosed(() => {
    setFile(null);
    setName('');
    setError(null);
  });
  useEffect(() => {
    if (initialFile) pick(initialFile);
  }, [initialFile]);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return setError('Bitte wähle ein Bild aus.');
    if (!name.trim()) return setError('Bitte gib dem Meme einen Namen.');
    setPending(true);
    setError(null);
    try {
      const meme = await api(`/api/memes?name=${encodeURIComponent(name.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      onUploaded(meme);
      controller.close();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal controller={controller} size="m">
      <Heading>Meme hochladen</Heading>
      <Content>
        <form id="upload-form" onSubmit={submit}>
          <Section>
            {preview ? (
              <Image src={preview} alt="Vorschau" withBorder withRoundedCorners className="upload-preview" />
            ) : (
              <FileDropZone accept={ACCEPT} onChange={(files) => pick(files?.[0])}>
                <IconImage />
                <Heading>Bild ablegen</Heading>
                <Text>JPG, PNG, GIF oder WebP. Einfügen mit Strg+V geht auch.</Text>
                <FileField accept={ACCEPT}>
                  <Button variant="outline" color="secondary">
                    Bild auswählen
                  </Button>
                </FileField>
              </FileDropZone>
            )}
            {preview && (
              <FileField accept={ACCEPT} onChange={(files) => pick(files?.[0])}>
                <Button variant="soft" color="secondary" size="s">
                  Anderes Bild wählen
                </Button>
              </FileField>
            )}
            <TextField value={name} onChange={setName} maxLength={120} isRequired>
              <Label>Name</Label>
            </TextField>
            {error && <AlertText status="danger">{error}</AlertText>}
          </Section>
        </form>
      </Content>
      <ActionGroup>
        <Button type="submit" form="upload-form" isPending={pending}>
          Hochladen
        </Button>
        <Action closeModal>
          <Button variant="soft" color="secondary">
            Abbrechen
          </Button>
        </Action>
      </ActionGroup>
    </Modal>
  );
}
