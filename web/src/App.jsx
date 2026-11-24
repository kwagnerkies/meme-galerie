import { useCallback, useEffect, useState } from 'react';
import {
  ActionGroup,
  Avatar,
  Button,
  Content,
  ContextMenu,
  ContextMenuTrigger,
  Flex,
  Heading,
  HeaderNavigation,
  IconFeedback,
  IconImage,
  IconLogout,
  IconRefresh,
  Initials,
  IconUpload,
  IllustratedMessage,
  Image,
  LayoutCard,
  MenuItem,
  Notification,
  Text,
  typedList,
  useModalController,
  useNotificationController,
} from '@mittwald/flow-react-components';
import { api, jsonBody, switchUi, syncVoteCache } from './api.js';
import { VoteControl } from './Votes.jsx';
import { memeStore, useMeme } from './memeStore.js';
import UploadModal from './UploadModal.jsx';
import MemeModal from './MemeModal.jsx';

const MemeList = typedList();

// Same as the classic UI's logout form: the server drops the session and redirects to /login
async function logout() {
  await fetch('/logout', { method: 'POST' }).catch(() => {});
  location.assign('/login');
}

// Sorting functions get table rows; votes are read live from the store.
// Ties go by upload date, newest first.
const live = (row) => memeStore.get(row.original.id) || row.original;
const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const byNewest = (rowA, rowB) => newest(rowA.original, rowB.original);
const sortBy = (key) => (rowA, rowB) => {
  const a = live(rowA);
  const b = live(rowB);
  return key(b) - key(a) || newest(a, b);
};

// Live part of a tile: subscribes to its meme, so a vote re-renders only this tile
function TileFooter({ id, onVote }) {
  const meme = useMeme(id);
  if (!meme) return null;
  return (
    <Flex align="center" justify="space-between" gap="s" wrap="wrap">
      <VoteControl meme={meme} onVote={onVote} />
      {meme.comments?.length > 0 && (
        <Flex align="center" gap="xs" className="muted" aria-label={`${meme.comments.length} Kommentare`}>
          <IconFeedback size="s" />
          <Text>{meme.comments.length}</Text>
        </Flex>
      )}
    </Flex>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [memes, setMemes] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [pastedFile, setPastedFile] = useState(null);
  const uploadModal = useModalController();
  const memeModal = useModalController();
  const notifications = useNotificationController();

  const showError = useCallback(
    (err) =>
      notifications.add(
        <Notification status="danger">
          <Heading>Das hat nicht geklappt</Heading>
          <Text>{err.message}</Text>
        </Notification>,
      ),
    [notifications],
  );

  useEffect(() => {
    Promise.all([api('/api/me'), api('/api/memes')])
      .then(([user, list]) => {
        setMe(user);
        syncVoteCache(list, { prune: true });
        memeStore.setAll(list);
        setMemes(list);
      })
      .catch(showError);
  }, [showError]);

  // Only a rename changes what the List itself shows and searches; everything else goes to the store
  const replaceMeme = useCallback((updated) => {
    const renamed = updated.name !== undefined && updated.name !== memeStore.get(updated.id)?.name;
    memeStore.set(updated);
    if (renamed) setMemes((list) => list.map((m) => (m.id === updated.id ? memeStore.get(m.id) : m)));
  }, []);

  // Optimistic: show the new vote right away, roll back if the server refuses
  const vote = useCallback(
    async ({ id }, value) => {
      const meme = memeStore.get(id);
      const old = meme.myVote || 0;
      const up = (meme.up || 0) - (old > 0) + (value > 0);
      const down = (meme.down || 0) - (old < 0) + (value < 0);
      replaceMeme({ ...meme, up, down, score: up - down, myVote: value });
      try {
        const updated = await api(`/api/memes/${meme.id}/vote`, { method: 'POST', ...jsonBody({ vote: value }) });
        syncVoteCache([updated]);
        replaceMeme(updated);
      } catch (err) {
        replaceMeme(meme);
        showError(err);
      }
    },
    [replaceMeme, showError],
  );

  const openMeme = useCallback(
    (meme) => {
      setSelectedId(meme.id);
      memeModal.open();
    },
    [memeModal],
  );

  const openUpload = useCallback(
    (file = null) => {
      setPastedFile(file);
      uploadModal.open();
    },
    [uploadModal],
  );

  // Ctrl+V with an image outside the detail view opens the upload directly
  useEffect(() => {
    const onPaste = (e) => {
      if (memeModal.isOpen) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) openUpload(item.getAsFile());
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [memeModal, openUpload]);

  const selected = useMeme(selectedId);

  const emptyView = (
    <IllustratedMessage>
      <IconImage />
      <Heading>Noch keine Memes</Heading>
      <Text>Lade das erste Meme hoch.</Text>
      <Button onPress={() => openUpload()}>Meme hochladen</Button>
    </IllustratedMessage>
  );

  return (
    <Flex direction="column" className="page app">
      <header className="app-header">
        <Flex align="center" wrap="wrap" gap="m" className="app-header-content">
          <Text className="wordmark">Meme-Galerie</Text>
          <HeaderNavigation aria-label="Konto" className="app-nav">
            <ContextMenuTrigger>
              <Button aria-label="Konto">
                <Avatar>
                  <Initials>{me?.name || '?'}</Initials>
                </Avatar>
              </Button>
              <ContextMenu>
                <MenuItem onAction={() => switchUi('classic')}>
                  <IconRefresh />
                  <Text>Klassische Ansicht</Text>
                </MenuItem>
                <MenuItem onAction={logout}>
                  <IconLogout />
                  <Text>Abmelden</Text>
                </MenuItem>
              </ContextMenu>
            </ContextMenuTrigger>
          </HeaderNavigation>
        </Flex>
      </header>

      <Flex elementType="main" direction="column" gap="m" className="app-content">
        <Heading level={1}>Memes</Heading>
        <LayoutCard>
          {memes && (
            <MemeList.List
              aria-label="Memes"
              getItemId={(m) => m.id}
              defaultViewMode="tiles"
              batchSize={24}
              infiniteScroll
              emptyView={emptyView}
              onAction={openMeme}
            >
              <MemeList.StaticData data={memes} />
              <ActionGroup>
                <Button onPress={() => openUpload()}>
                  <IconUpload />
                  <Text>Meme hochladen</Text>
                </Button>
              </ActionGroup>
              <MemeList.Search />
              <MemeList.Sorting
                property="$new"
                name="Neueste zuerst"
                customSortingFn={byNewest}
                defaultEnabled
              />
              <MemeList.Sorting property="$up" name="Meiste Upvotes" customSortingFn={sortBy((m) => m.up || 0)} />
              <MemeList.Sorting property="$score" name="Bester Score" customSortingFn={sortBy((m) => m.score || 0)} />
              <MemeList.Item
                showTiles
                showList={false}
                tileMaxWidth={220}
                textValue={(m) => m.name}
                renderDependencies={[vote]}
              >
                {(meme) => (
                  <div className="meme-tile" title={meme.uploadedBy ? `${meme.name} – von ${meme.uploadedBy.name}` : meme.name}>
                    <Image src={`/uploads/${meme.file}`} alt={meme.name} aspectRatio={1} withRoundedCorners={false} loading="lazy" decoding="async" />
                    <Flex direction="column" gap="xs" padding="s">
                      <Text className="tile-name">{meme.name}</Text>
                      <TileFooter id={meme.id} onVote={vote} />
                    </Flex>
                  </div>
                )}
              </MemeList.Item>
            </MemeList.List>
          )}
        </LayoutCard>
      </Flex>

      <UploadModal
        controller={uploadModal}
        initialFile={pastedFile}
        onUploaded={(meme) => {
          memeStore.set(meme);
          setMemes((list) => [meme, ...list]);
        }}
      />
      <MemeModal
        controller={memeModal}
        meme={selected}
        me={me}
        onVote={vote}
        onChanged={replaceMeme}
        onDeleted={(id) => {
          setMemes((list) => list.filter((m) => m.id !== id));
          memeStore.remove(id);
        }}
        onError={showError}
      />
    </Flex>
  );
}
