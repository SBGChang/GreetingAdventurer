import type {CombatView, CombatFrame, CombatResolvedActionView} from './engine/game-facade';
import type {SpriteBattlePresentation} from './combat-sprite-catalog';
import type {CombatGround} from './combat-ground';
export interface CombatArenaProps {
  ground:CombatGround;
  highlightedId?: string;
  spritePresentation?: SpriteBattlePresentation;
  view: CombatView;
  frame?: CombatFrame;
  progress: number;
  selecting: boolean;
  validTargetIds:readonly string[];
  onTarget: (id: string) => void;
  label: (unit: CombatView['combatants'][number]) => string;
  actionLabel: (action: CombatResolvedActionView) => string;
  loadingLabel: string;
  onReady?: (ready: boolean) => void;
}
