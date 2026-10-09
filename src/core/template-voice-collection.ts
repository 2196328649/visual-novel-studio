import type { UiComponent } from './model';

// Original page geometry and skins, including the two collection entry tabs.
export const templateVoiceCollectionComponents: UiComponent[] = [
  {
    "id": "ai_gallery_voicecollection",
    "page": "gallery",
    "kind": "button",
    "text": "语音收藏",
    "skin": {
      "idle": "ai_ui_474abf89497a60f5",
      "hover": "ai_ui_38bbef43424beca2",
      "pressed": "ai_ui_38bbef43424beca2",
      "selected": "ai_ui_38bbef43424beca2",
      "disabled": "ai_ui_474abf89497a60f5",
      "fit": "stretch",
      "hideText": true
    },
    "action": "voiceCollection",
    "x": 0.8130208333333333,
    "y": 0.8555555555555555,
    "width": 0.1046875,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_musicroom_voicecollection",
    "page": "musicRoom",
    "kind": "button",
    "text": "语音收藏",
    "skin": {
      "idle": "ai_ui_474abf89497a60f5",
      "hover": "ai_ui_38bbef43424beca2",
      "pressed": "ai_ui_38bbef43424beca2",
      "selected": "ai_ui_38bbef43424beca2",
      "disabled": "ai_ui_474abf89497a60f5",
      "fit": "stretch",
      "hideText": true
    },
    "action": "voiceCollection",
    "x": 0.8130208333333333,
    "y": 0.8555555555555555,
    "width": 0.1046875,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_voicecollection_background",
    "page": "voiceCollection",
    "kind": "image",
    "text": "收藏页背景",
    "assetId": "ai_ui_1cdd2af878343bb4",
    "style": {
      "imageFit": "stretch"
    },
    "x": 0,
    "y": 0,
    "width": 1,
    "height": 1
  },
  {
    "id": "ai_voicecollection_title",
    "page": "voiceCollection",
    "kind": "image",
    "text": "页面标题",
    "assetId": "ai_ui_3fe87d01944dc067",
    "style": {
      "imageFit": "stretch"
    },
    "x": 0,
    "y": 0,
    "width": 0.2234375,
    "height": 0.275
  },
  {
    "id": "ai_voicecollection_cggallery",
    "page": "voiceCollection",
    "kind": "button",
    "text": "画廊",
    "skin": {
      "idle": "ai_ui_0d07463cfbefcde1",
      "hover": "ai_ui_526e28b9132cc4b6",
      "pressed": "ai_ui_526e28b9132cc4b6",
      "selected": "ai_ui_526e28b9132cc4b6",
      "disabled": "ai_ui_0d07463cfbefcde1",
      "fit": "stretch",
      "hideText": true
    },
    "action": "gallery",
    "x": 0.6036458333333333,
    "y": 0.8555555555555555,
    "width": 0.1046875,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_voicecollection_soundroom",
    "page": "voiceCollection",
    "kind": "button",
    "text": "音乐室",
    "skin": {
      "idle": "ai_ui_7fcb375040487ec2",
      "hover": "ai_ui_d95cb2a057de7d3b",
      "pressed": "ai_ui_d95cb2a057de7d3b",
      "selected": "ai_ui_d95cb2a057de7d3b",
      "disabled": "ai_ui_7fcb375040487ec2",
      "fit": "stretch",
      "hideText": true
    },
    "action": "music",
    "x": 0.7083333333333334,
    "y": 0.8555555555555555,
    "width": 0.1046875,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_voicecollection_voicecollection",
    "page": "voiceCollection",
    "kind": "button",
    "text": "语音收藏",
    "skin": {
      "idle": "ai_ui_474abf89497a60f5",
      "hover": "ai_ui_38bbef43424beca2",
      "pressed": "ai_ui_38bbef43424beca2",
      "selected": "ai_ui_38bbef43424beca2",
      "disabled": "ai_ui_474abf89497a60f5",
      "fit": "stretch",
      "hideText": true
    },
    "action": "voiceCollection",
    "x": 0.8130208333333333,
    "y": 0.8555555555555555,
    "width": 0.1046875,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_voicecollection_buttonback",
    "page": "voiceCollection",
    "kind": "button",
    "text": "返回",
    "skin": {
      "idle": "ai_ui_8bfb06cb96d911a1",
      "hover": "ai_ui_d030d9b3fa6929af",
      "pressed": "ai_ui_d030d9b3fa6929af",
      "selected": "ai_ui_d030d9b3fa6929af",
      "fit": "stretch",
      "hideText": true
    },
    "action": "return",
    "x": 0.9177083333333333,
    "y": 0.8555555555555555,
    "width": 0.08229166666666667,
    "height": 0.06666666666666667
  },
  {
    "id": "ai_voicecollection_items",
    "page": "voiceCollection",
    "kind": "voiceCollection",
    "text": "语音收藏",
    "skin": {
      "idle": "ai_ui_2b7a303e3c692647",
      "hover": "ai_ui_1557cc810ffe6d5d",
      "pressed": "ai_ui_115dcfd0d31b41cf",
      "selected": "ai_ui_115dcfd0d31b41cf",
      "fit": "stretch",
      "hideText": false
    },
    "list": {
      "columns": 2,
      "rows": 6,
      "gapX": 106.0999984741211,
      "gapY": 13.399999618530273,
      "itemWidth": 701,
      "itemHeight": 94,
      "caption": {
        "x": 0.018111600345279623,
        "y": 0.17553189460267413,
        "width": 0.840804280976256,
        "height": 0.5543361826145903
      },
      "navigationRect": {
        "x": 0.2214629187650899,
        "y": 0.9221002759712877,
        "width": 0.2617134958389835,
        "height": 0.0703610410581917
      },
      "pageSkin": {
        "idle": "ai_ui_61de9603402a4b8b",
        "hover": "ai_ui_d5f4fd1259fce963",
        "pressed": "ai_ui_d5f4fd1259fce963",
        "selected": "ai_ui_3f3c05e3efb72e1c",
        "fit": "stretch",
        "hideText": false
      },
      "pageTextColor": "#ffffff",
      "pageSelectedTextColor": "#ffffff",
      "favoritesOnly": true,
      "showVoiceControls": false,
      "voiceSingleLine": true,
      "voiceCaptionMode": "text",
      "voiceFavoriteRect": {
        "x": 0.8589158350662907,
        "y": 0.13829787234042554,
        "width": 0.09700427960057062,
        "height": 0.723404255319149
      },
      "voiceButtonSize": 68,
      "voiceReplaySkin": {
        "idle": "ai_ui_855934aececc01ac",
        "hover": "ai_ui_49ab8248de5c8a7c",
        "pressed": "ai_ui_49ab8248de5c8a7c",
        "selected": "ai_ui_49ab8248de5c8a7c",
        "fit": "stretch",
        "hideText": true
      },
      "voiceFavoriteSkin": {
        "idle": "ai_ui_139727996abeb7fa",
        "hover": "ai_ui_603322bc82a46af6",
        "pressed": "ai_ui_603322bc82a46af6",
        "selected": "ai_ui_603322bc82a46af6",
        "fit": "stretch",
        "hideText": true
      },
      "voiceOrder": "favorites",
      "voiceRemoveConfirm": true
    },
    "style": {
      "fontSize": 36,
      "fontAssetId": "ai_ui_e1048c68ae7d4eb5",
      "textColor": "#000000",
      "align": "left"
    },
    "x": 0.06793750921885172,
    "y": 0.18898612128363715,
    "width": 0.8597187519073486,
    "height": 0.7369398046422888
  }
];
