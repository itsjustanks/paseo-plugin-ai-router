import React, { useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { TabId } from "./navigation";
import { Card, Chip, HostIcon, IconBadge, Link, Row, TYPE, tint } from "./ui";

type Theme = PluginTheme;
type Go = (tab: TabId) => void;

/** Below this width the "How it works" steps stack top to bottom instead of left to right. */
const FLOW_STACK_WIDTH = 640;

/** The container's own width, so a layout can follow a half-width window as well as a phone. Null until measured. */
function useWidth(): [number | null, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState<number | null>(null);
  return [width, (event) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  }];
}

const bold = { fontWeight: "700" } as const;

// ---------------------------------------------------------------- what is it

/** "What is AI Router?", with the kinds of account this router offers when the model list names them. */
export function WhatIsCard({ theme, router, accounts }: { theme: Theme; router: string; accounts: readonly string[] }) {
  return (
    <Card theme={theme} title="What is AI Router?" icon="Route">
      <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>
        {`AI Router is one connection that lets every chat in Paseo use all of your team's AI subscriptions (Claude, ChatGPT/Codex, Kimi and more) through one shared router called ${router}.`}
      </Text>
      <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>
        You sign in to your AI accounts once, on the router, instead of on every computer. The router then shares the work between those accounts, so when one is busy another can answer.
      </Text>
      {accounts.length ? (
        <Row>
          <Text style={{ ...TYPE.secondary, color: theme.colors.foregroundMuted }}>On your router now:</Text>
          {accounts.map((name) => <Chip key={name} theme={theme} label={name} tone="success" />)}
        </Row>
      ) : null}
    </Card>
  );
}

// -------------------------------------------------------------- how it works

const FLOW = [
  { icon: "MessageSquare", title: "You pick a model", text: "In a Paseo chat, you choose the AI Router provider and a model." },
  { icon: "Laptop", title: "AI Router sends it", text: "This plugin, on this computer, passes your request to the shared router." },
  { icon: "Route", title: "The router picks an account", text: "It chooses one of your team's AI accounts that still has room left." },
  { icon: "CornerDownLeft", title: "The answer comes back", text: "The reply appears in your chat, just as it always does." },
] as const;

function Arrow({ theme, down }: { theme: Theme; down: boolean }) {
  const glyph = HostIcon ? <HostIcon name={down ? "ArrowDown" : "ArrowRight"} size={20} color={theme.colors.foregroundMuted} /> : <Text style={{ ...TYPE.lead, color: theme.colors.foregroundMuted }}>{down ? "↓" : "→"}</Text>;
  return <View accessible={false} style={down ? { width: 48, alignItems: "center", paddingVertical: 2 } : { paddingTop: 16, width: 24, alignItems: "center" }}>{glyph}</View>;
}

/** Four steps with icons and arrows: across on a wide screen, down on a narrow one. */
export function HowItWorksCard({ theme, compact, router }: { theme: Theme; compact: boolean; router: string }) {
  const [width, onLayout] = useWidth();
  const stacked = width === null ? compact : width < FLOW_STACK_WIDTH;
  const steps = FLOW.map((step) => (step.icon === "Route" ? { ...step, title: `${router} picks an account` } : step));
  return (
    <Card theme={theme} title="How it works" icon="Workflow">
      <View onLayout={onLayout} style={{ flexDirection: stacked ? "column" : "row", alignItems: stacked ? "stretch" : "flex-start" }}>
        {steps.map((step, index) => (
          <React.Fragment key={step.icon}>
            {index > 0 ? <Arrow theme={theme} down={stacked} /> : null}
            {stacked ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <IconBadge theme={theme} name={step.icon} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>{`${index + 1}. ${step.title}`}</Text>
                  <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>{step.text}</Text>
                </View>
              </View>
            ) : (
              <View style={{ flex: 1, alignItems: "center", gap: 8, paddingHorizontal: 4 }}>
                <IconBadge theme={theme} name={step.icon} size={52} />
                <Text style={{ ...TYPE.item, color: theme.colors.foreground, textAlign: "center" }}>{`${index + 1}. ${step.title}`}</Text>
                <Text style={{ ...TYPE.secondary, color: theme.colors.foreground, textAlign: "center" }}>{step.text}</Text>
              </View>
            )}
          </React.Fragment>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 12, backgroundColor: tint(theme.colors.accent, 0.07) ?? theme.colors.surface2 }}>
        {HostIcon ? <View style={{ paddingTop: 3 }}><HostIcon name="RefreshCw" size={18} color={theme.colors.accent} /></View> : null}
        <Text style={{ ...TYPE.body, color: theme.colors.foreground, flex: 1 }}>
          <Text style={bold}>If an account is busy</Text>
          {" or has used up its allowance, the router tries another one by itself, so your chat keeps going."}
        </Text>
      </View>
    </Card>
  );
}

// ----------------------------------------------------------------- how to use

function Step({ theme, n, children }: { theme: Theme; n: number; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: theme.colors.accent, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Text style={{ ...TYPE.secondary, color: theme.colors.accentForeground, fontWeight: "700" }}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 2, paddingTop: 3 }}>{children}</View>
    </View>
  );
}

/** Numbered steps for a first chat, and the other way in: keeping built-in Claude and re-routing it. */
export function HowToUseCard({ theme, go, synced }: { theme: Theme; go: Go; synced: boolean }) {
  const body = { ...TYPE.body, color: theme.colors.foreground };
  return (
    <Card theme={theme} title="How to use it" icon="ListOrdered">
      <Step theme={theme} n={1}><Text style={body}>Start a new chat in Paseo.</Text></Step>
      <Step theme={theme} n={2}>
        <Text style={body}>In the provider menu, choose <Text style={bold}>AI Router</Text>.</Text>
        {!synced ? <Link theme={theme} label="Not in the menu yet? Sync models on the Models tab" onPress={() => go("models")} /> : null}
      </Step>
      <Step theme={theme} n={3}>
        <Text style={body}>Pick a model. Or pick a <Text style={bold}>combo</Text>, such as “Auto · Coding”, and the router picks the best model for the job each time.</Text>
      </Step>
      <Step theme={theme} n={4}>
        <Text style={body}>Set the thinking level and mode as you normally would. They work the same as with any other provider.</Text>
      </Step>
      <View style={{ gap: 4, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0 }}>
        <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>Rather keep the built-in Claude provider?</Text>
        <Text style={body}>Switch on re-routing in the Providers tab, and its chats go through the router too. It asks before changing anything.</Text>
        <Link theme={theme} label="Open Providers" accessibilityLabel="Open the Providers tab" onPress={() => go("providers")} />
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ glossary

const WORDS = [
  { icon: "Plug", term: "Provider", text: "What you choose when you start a chat, such as Claude, Codex or AI Router. It decides how the chat reaches an AI." },
  { icon: "Boxes", term: "Model", text: "The AI that writes the replies, such as Claude Opus or GPT-6 Sol. Each provider offers several." },
  { icon: "Layers", term: "Combo", text: "A named group of models, such as “Auto · Coding”. You pick the combo; the router picks the model in it that suits the job." },
  { icon: "Route", term: "Router (OmniRoute)", text: "The shared service your team runs. It holds everyone's AI accounts and sends each request to one of them." },
  { icon: "Users", term: "Account", text: "One AI subscription, such as a Claude or ChatGPT plan, signed in once on the router." },
  { icon: "KeyRound", term: "Key and access tier", text: "Works like a password for this computer. An API key is enough to chat; a read token also shows accounts and usage; a manage key can change router settings." },
  { icon: "Waypoints", term: "Routing", text: "Choosing which account and model answer a request. Re-routing a built-in provider sends its chats through the router instead of its own sign-in." },
  { icon: "Server", term: "Daemon", text: "The Paseo program that runs your chats, on a computer or a server. Each one uses its own key, so its usage shows separately." },
] as const;

/** One plain line for each word the panel uses, two across when there is room. */
export function GlossaryCard({ theme }: { theme: Theme }) {
  return (
    <Card theme={theme} title="Words you'll see" icon="BookOpen">
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 24, rowGap: 16 }}>
        {WORDS.map((word) => (
          <View key={word.term} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, flexBasis: 300, flexGrow: 1, flexShrink: 1 }}>
            <IconBadge theme={theme} name={word.icon} size={30} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...TYPE.item, color: theme.colors.foreground }}>{word.term}</Text>
              <Text style={{ ...TYPE.body, color: theme.colors.foreground }}>{word.text}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Overview's guide, top to bottom: what it is, how it works, how to use it, and the words. */
export function OverviewGuide({ theme, compact, go, router, accounts, synced }: { theme: Theme; compact: boolean; go: Go; router: string; accounts: readonly string[]; synced: boolean }) {
  return (
    <>
      <WhatIsCard theme={theme} router={router} accounts={accounts} />
      <HowItWorksCard theme={theme} compact={compact} router={router} />
      <HowToUseCard theme={theme} go={go} synced={synced} />
      <GlossaryCard theme={theme} />
    </>
  );
}
