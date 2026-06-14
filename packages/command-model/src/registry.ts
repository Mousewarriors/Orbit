import type {
  CommandCustomisation,
  CommandDefinition,
  CommandUsage,
} from '@orbit/shared-types';

/** In-memory registry of commands, their user customisations and usage stats. */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly customisations = new Map<string, CommandCustomisation>();
  private readonly usage = new Map<string, CommandUsage>();

  register(command: CommandDefinition): void {
    this.commands.set(command.id, command);
  }

  registerAll(commands: Iterable<CommandDefinition>): void {
    for (const c of commands) this.register(c);
  }

  /** Remove a command and all commands from a crashed extension. */
  unregister(commandId: string): boolean {
    return this.commands.delete(commandId);
  }

  unregisterExtension(extensionId: string): number {
    let removed = 0;
    for (const [id, cmd] of this.commands) {
      if (cmd.source.kind === 'extension' && cmd.source.extensionId === extensionId) {
        this.commands.delete(id);
        removed++;
      }
    }
    return removed;
  }

  get(commandId: string): CommandDefinition | undefined {
    return this.commands.get(commandId);
  }

  list(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  /** Only enabled commands, used by Root Search. */
  listEnabled(): CommandDefinition[] {
    return this.list().filter((c) => c.enabled);
  }

  setCustomisation(c: CommandCustomisation): void {
    this.customisations.set(c.commandId, c);
  }

  getCustomisation(commandId: string): CommandCustomisation | undefined {
    return this.customisations.get(commandId);
  }

  /** Record a use, updating count and timestamp. */
  recordUsage(commandId: string, at: number): void {
    const prev = this.usage.get(commandId);
    this.usage.set(commandId, {
      commandId,
      useCount: (prev?.useCount ?? 0) + 1,
      lastUsedAt: at,
    });
  }

  getUsage(commandId: string): CommandUsage | undefined {
    return this.usage.get(commandId);
  }

  /** Snapshot of all aliases → commandId for alias resolution & conflicts. */
  aliasMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [commandId, c] of this.customisations) {
      if (c.alias) map.set(c.alias.toLowerCase(), commandId);
    }
    return map;
  }

  /** Snapshot of all hotkeys → commandId for conflict detection. */
  hotkeyMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const [commandId, c] of this.customisations) {
      if (c.hotkey) map.set(commandId, c.hotkey);
    }
    return map;
  }
}
