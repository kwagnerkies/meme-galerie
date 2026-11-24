import { useEffect, useState } from 'react';
import {
  AlertText,
  Button,
  Flex,
  Heading,
  Label,
  LayoutCard,
  Section,
  Text,
  TextField,
} from '@mittwald/flow-react-components';
import { switchUi } from './api.js';

const MESSAGES = {
  blocked: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.',
  oidc: 'Die Anmeldung über Keycloak hat nicht geklappt. Bitte versuche es erneut.',
};

// Focus-task layout: a single card, centered, without navigation.
// The form posts natively to /login, the server answers with a redirect.
export default function Login() {
  const [oidc, setOidc] = useState(false);
  const error = new URLSearchParams(location.search).get('error');

  useEffect(() => {
    fetch('/api/login-config')
      .then((res) => res.json())
      .then((config) => setOidc(Boolean(config.oidc)))
      .catch(() => {});
  }, []);

  return (
    <Flex justify="center" align="center" paddingBlock="l" paddingInline="m" className="page focus-page">
      <Flex elementType="main" direction="column" align="stretch" gap="l" className="focus-center">
        <Heading level={1} className="wordmark">
          Meme-Galerie
        </Heading>
        <LayoutCard>
          <form method="post" action="/login">
            <Section>
              <Heading>Anmelden</Heading>
              {error && <AlertText status="danger">{MESSAGES[error] || 'Benutzername oder Passwort ist falsch.'}</AlertText>}
              {oidc && (
                <>
                  <Button onPress={() => location.assign('/auth/login')}>Mit Keycloak anmelden</Button>
                  <Text>oder mit Benutzername und Passwort:</Text>
                </>
              )}
              <TextField name="username" autoComplete="username" isRequired autoFocus={!oidc}>
                <Label>Benutzername</Label>
              </TextField>
              <TextField name="password" type="password" autoComplete="current-password" isRequired>
                <Label>Passwort</Label>
              </TextField>
              <Flex justify="end">
                <Button type="submit" variant={oidc ? 'soft' : 'solid'} color={oidc ? 'secondary' : 'primary'}>
                  Anmelden
                </Button>
              </Flex>
            </Section>
          </form>
        </LayoutCard>
        <Flex justify="center">
          <Button variant="plain" color="secondary" size="s" onPress={() => switchUi('classic')}>
            Zur klassischen Ansicht
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
