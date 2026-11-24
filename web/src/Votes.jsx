import { Button, Flex, Icon, IconChevronDown, IconChevronUp, Text } from '@mittwald/flow-react-components';

// Award icon from the SVG sprite in index.html, wrapped in Flow's Icon for sizing
export function AwardIcon({ id, size = 's' }) {
  return (
    <Icon size={size}>
      <svg viewBox="0 0 32 32">
        <use href={`#award-${id}`} />
      </svg>
    </Icon>
  );
}

export function VoteControl({ meme, onVote }) {
  const mine = meme.myVote || 0;
  const toggle = (value) => onVote(meme, mine === value ? 0 : value);
  return (
    <Flex align="center" gap="xs" className="votes">
      <Button
        size="s"
        variant={mine === 1 ? 'solid' : 'soft'}
        color={mine === 1 ? 'primary' : 'secondary'}
        aria-label="Upvote"
        aria-pressed={mine === 1}
        onPress={() => toggle(1)}
      >
        <IconChevronUp />
      </Button>
      <Text className="score" aria-label={`Score ${meme.score || 0}: ${meme.up || 0} Upvotes, ${meme.down || 0} Downvotes`}>
        {meme.score || 0}
      </Text>
      <Button
        size="s"
        variant={mine === -1 ? 'solid' : 'soft'}
        color={mine === -1 ? 'danger' : 'secondary'}
        aria-label="Downvote"
        aria-pressed={mine === -1}
        onPress={() => toggle(-1)}
      >
        <IconChevronDown />
      </Button>
    </Flex>
  );
}

// Compact award display for a tile: up to three icons plus the total
export function AwardSummary({ meme, awardTypes }) {
  const entries = Object.entries(meme.awards || {}).filter(([id]) => awardTypes.some((a) => a.id === id));
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const top = [...entries].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const label = entries.map(([id, n]) => `${awardTypes.find((a) => a.id === id).name} ×${n}`).join(', ');
  return (
    <Flex align="center" gap="xs" className="award-summary" aria-label={`Awards: ${label}`}>
      {top.map(([id]) => (
        <AwardIcon key={id} id={id} />
      ))}
      {total > 1 && <Text>{total}</Text>}
    </Flex>
  );
}

// Detail view: one toggle button per award type
export function AwardPicker({ meme, awardTypes, onAward }) {
  const mine = meme.myAwards || [];
  return (
    <Flex wrap="wrap" gap="s">
      {awardTypes.map((a) => {
        const given = mine.includes(a.id);
        const count = meme.awards?.[a.id] || 0;
        return (
          <Button
            key={a.id}
            size="s"
            variant={given ? 'soft' : 'outline'}
            color={given ? 'primary' : 'secondary'}
            aria-pressed={given}
            aria-label={given ? `${a.name} zurücknehmen` : `${a.name} vergeben`}
            onPress={() => onAward(meme, a.id, !given)}
          >
            <AwardIcon id={a.id} size="m" />
            {count > 0 && <Text>{count}</Text>}
          </Button>
        );
      })}
    </Flex>
  );
}
