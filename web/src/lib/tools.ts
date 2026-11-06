export type ToolId = "hammer" | "bat" | "press" | "laser" | "bomb";

export const TOOLS: { id: ToolId; label: string; icon: string; hint: string }[] = [
  { id: "hammer", label: "망치", icon: "🔨", hint: "물체를 탭해서 내려쳐요" },
  { id: "bat", label: "알루미늄 배트", icon: "⚾", hint: "탭한 곳을 옆으로 풀스윙해요" },
  { id: "press", label: "유압 프레스", icon: "🗜️", hint: "아무 곳이나 탭하면 위에서 눌러요" },
  { id: "laser", label: "레이저", icon: "🔴", hint: "손가락으로 길을 그리면 레이저가 그대로 지나가며 잘라요" },
  { id: "bomb", label: "폭탄", icon: "💣", hint: "탭한 곳에 폭탄을 놓아요" },
];

/** Durability a single blow takes off. */
export const TOOL_DAMAGE: Record<"hammer" | "bat", number> = { hammer: 1, bat: 2 };

/** Something the sound layer can react to. */
export interface SmashEvent {
  type: "hit" | "break" | "explode" | "cut" | "crush";
  tool: ToolId;
  material?: string;
  /** 0-1, rough loudness. */
  strength: number;
}
