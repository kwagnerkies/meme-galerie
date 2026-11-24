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
import { AwardSummary, VoteControl } from './Votes.jsx';
import UploadModal from './UploadModal.jsx';
import MemeModal from './MemeModal.jsx';

const MemeList = typedList();

// Same as the classic UI's logout form: the server drops the session and redirects to /login
async function logout() {
  await fetch('/logout', { method: 'POST' }).catch(() => {});
  location.assign('/login');
}

const awardTotal = (m) => Object.values(m.awards || {}).reduce((sum, n) => sum + n, 0);
// Sorting functions get table rows; ties go by upload date, newest first
const newest = (a, b) => b.createdAt.localeCompare(a.createdAt);
const byNewest = (rowA, rowB) => newest(rowA.original, rowB.original);
const sortBy = (key) => (rowA, rowB) => {
  const a = rowA.original;
  const b = rowB.original;
  return key(b) - key(a) || newest(a, b);
};

export default function App() {
  const [me, setMe] = useState(null);
  const [memes, setMemes] = useState(null);
  const [awardTypes, setAwardTypes] = useState([]);
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
    Promise.all([api('/api/me'), api('/api/awards'), api('/api/memes')])
      .then(([user, types, list]) => {
        setMe(user);
        setAwardTypes(types);
        syncVoteCache(list, { prune: true });
        setMemes(list);
      })
      .catch(showError);
  }, [showError]);

  const replaceMeme = useCallback((updated) => {
    setMemes((list) => list.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  }, []);

  // Optimistic: show the new vote right away, roll back if the server refuses
  const vote = useCallback(
    async (meme, value) => {
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

  const award = useCallback(
    async (meme, id, given) => {
      const awards = { ...meme.awards, [id]: (meme.awards?.[id] || 0) + (given ? 1 : -1) };
      if (awards[id] <= 0) delete awards[id];
      const myAwards = given ? [...(meme.myAwards || []), id] : (meme.myAwards || []).filter((a) => a !== id);
      replaceMeme({ ...meme, awards, myAwards });
      try {
        const updated = await api(`/api/memes/${meme.id}/awards`, { method: 'POST', ...jsonBody({ award: id, given }) });
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

  const selected = memes?.find((m) => m.id === selectedId);

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
              batchSize={40}
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
              <MemeList.Sorting property="$awards" name="Meiste Awards" customSortingFn={sortBy(awardTotal)} />
              <MemeList.Item
                showTiles
                showList={false}
                textValue={(m) => m.name}
                renderDependencies={[awardTypes, vote]}
              >
                {(meme) => (
                  <MemeList.ItemView>
                    <Avatar>
                      <Image src={`/uploads/${meme.file}`} alt={meme.name} />
                    </Avatar>
                    <Heading>{meme.name}</Heading>
                    <Text>{meme.uploadedBy ? `von ${meme.uploadedBy.name}` : ' '}</Text>
                    <Content slot="bottom">
                      <Flex align="center" justify="space-between" gap="s" wrap="wrap">
                        <VoteControl meme={meme} onVote={vote} />
                        <AwardSummary meme={meme} awardTypes={awardTypes} />
                        {meme.comments?.length > 0 && <Text className="muted">💬 {meme.comments.length}</Text>}
                      </Flex>
                    </Content>
                  </MemeList.ItemView>
                )}
              </MemeList.Item>
            </MemeList.List>
          )}
        </LayoutCard>
      </Flex>

      <UploadModal
        controller={uploadModal}
        initialFile={pastedFile}
        onUploaded={(meme) => setMemes((list) => [meme, ...list])}
      />
      <MemeModal
        controller={memeModal}
        meme={selected}
        me={me}
        awardTypes={awardTypes}
        onVote={vote}
        onAward={award}
        onChanged={replaceMeme}
        onDeleted={(id) => setMemes((list) => list.filter((m) => m.id !== id))}
        onError={showError}
      />
    </Flex>
  );
}
