export const uiButtonEvents = {
 hover: { name: '悬停时', unreal: 'OnHovered' },
 unhover: { name: '移出时', unreal: 'OnUnhovered' },
 press: { name: '按下时', unreal: 'OnPressed' },
 release: { name: '松开时', unreal: 'OnReleased' },
} as const;
export type UiButtonEvent = keyof typeof uiButtonEvents;
export const isUiButtonEvent = (value: string): value is UiButtonEvent => Object.hasOwn(uiButtonEvents,value);
