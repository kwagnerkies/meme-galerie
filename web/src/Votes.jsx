import { Button, Flex, IconChevronDown, IconChevronUp, Text } from '@mittwald/flow-react-components';

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
