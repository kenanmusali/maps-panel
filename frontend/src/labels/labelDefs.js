// labelDefs.js — the full list of interface-text strings editor_2 is
// allowed to rename, grouped the way they'll show up on the label-editor
// screen. Each id is what components pass to t(id, default) at render
// time; `default` here is exactly the text currently hard-coded in the
// UI, so a label that's never been overridden looks identical to today.
//
// This list intentionally covers static UI text only — button labels,
// panel-tab names, headings, hints, popup titles. It never includes
// admin-authored diagram content (node text, panel/lane names, document
// titles, axis names, etc.) — that stays admin-only and lives in the
// diagram data itself, not here.

export const LABEL_GROUPS = [
  {
    group: 'Yuxarı naviqasiya paneli',
    items: [
      { id: 'topbar.fullwidth_on', default: 'Tam en' },
      { id: 'topbar.fullwidth_off', default: 'Klassik' },
      { id: 'topbar.panel', default: 'Panel' },
      { id: 'topbar.presentation', default: 'Təqdimat' },
      { id: 'topbar.save', default: 'Yadda saxla' },
      { id: 'topbar.saving', default: 'Saxlanılır...' },
      { id: 'topbar.saved', default: 'Saxlanıldı' },
      { id: 'topbar.edit', default: 'Redaktə et' },
      { id: 'topbar.view', default: 'Baxış' },
      { id: 'topbar.logout', default: 'Çıxış' }
    ]
  },
  {
    group: 'Redaktor paneli (bölmə adları)',
    items: [
      { id: 'panel.tab.diagram', default: 'Başliq' },
      { id: 'panel.tab.theme', default: 'Rəng Seçimi' },
      { id: 'panel.tab.panels', default: 'Sütunlar' },
      { id: 'panel.tab.addnode', default: 'Proseslər' },
      { id: 'panel.tab.export', default: 'Paylaş' }
    ]
  },
  {
    group: 'Sənəd sahələri',
    items: [
      { id: 'meta.doc_name_label', default: 'Sənədin Adı' },
      { id: 'meta.doc_number_label', default: 'Sənədin Nömrəsi' },
      { id: 'meta.save_hint', default: 'Dəyişikliklər "Yadda saxla" düyməsi ilə qeyd olunur.' },
      { id: 'meta.archive_btn', default: 'Bu diaqramı arxivə köçür' }
    ]
  },
  {
    group: 'Rəng Seçimi paneli',
    items: [
      { id: 'theme.hint', default: 'Bütün diaqrama tətbiq olunan rənglər. Ayrı-ayrı node və oxlar öz rənglərini üstələyə bilər.' },
      { id: 'theme.node_label', default: 'Proseslərin rəngini dəyişin' },
      { id: 'theme.edge_label', default: 'Yalnız oxların rəngini dəyişin' },
      { id: 'theme.lane_label', default: 'Sütunların rəngini dəyişin' },
      { id: 'theme.all_label', default: 'Hamısına birdən tətbiq et' },
      { id: 'theme.reset_btn', default: 'Standart rəngə qaytar' }
    ]
  },
  {
    group: 'Proseslər paneli',
    items: [
      { id: 'shapes.border_label', default: 'Sərhəd:' },
      { id: 'shapes.drag_hint', default: 'Formanı canvas üzərinə sürükləyin — buraxdığınız yerə əlavə olunur. Yaxud klikləyin — ekranda görünən panelə avtomatik əlavə olunur.' },
      { id: 'style.solid', default: 'Tam' },
      { id: 'style.stroke', default: 'Stroke' },
      { id: 'style.dashed', default: 'Kəsik' },
      { id: 'shape.pill', default: 'Başlıq' },
      { id: 'shape.rect', default: 'Əsas Proses' },
      { id: 'shape.diamond', default: 'Şərt' },
      { id: 'shape.parallelogram', default: 'Data Məlumatı' },
      { id: 'shape.subprocess', default: 'Alt Proses' },
      { id: 'shape.manualinput', default: 'Əl ilə görülən işlər' },
      { id: 'shape.document', default: 'Sənəd/Qeyd' },
      { id: 'shape.preparation', default: 'Hazırlıq' },
      { id: 'shape.delay', default: 'Gecikmə' },
      { id: 'shape.trapezoid', default: 'Trapesiya' },
      { id: 'shape.triangledown', default: 'Birləşdirmə' },
      { id: 'shape.roundright', default: 'Gecikmə' }
    ]
  },
  {
    group: 'Node menyusu (sağ-klik)',
    items: [
      { id: 'nodemenu.shape_tab', default: 'Forma/Stil' },
      { id: 'nodemenu.size_tab', default: 'Ölçü/Panel' },
      { id: 'nodemenu.color_tab', default: 'Rəng' },
      { id: 'nodemenu.text_tab', default: 'Mətn' },
      { id: 'nodemenu.popup_tab', default: 'Popup' },
      { id: 'nodemenu.delete', default: 'Sil' },
      { id: 'multiselect.border_label', default: 'Sərhəd' }
    ]
  },
  {
    group: 'Status',
    items: [
      { id: 'status.placeholder', default: 'Status' },
      { id: 'status.progress', default: 'Müzakirədə' },
      { id: 'status.done', default: 'Təsdiqlənmiş ' },
      { id: 'status.notdone', default: 'Təsdqlənməmiş' },
      { id: 'status.sign', default: 'İmza Prosesində' },
      { id: 'status.none', default: 'Statussuz' }
    ]
  },
  {
    group: 'Ana səhifə',
    items: [
      { id: 'home.new_group', default: 'Yeni qrup yarat' }
    ]
  }
];

// Flat lookup used by the label-editor screen and elsewhere.
export const ALL_LABEL_IDS = LABEL_GROUPS.flatMap(g => g.items.map(i => i.id));

export function defaultFor(id) {
  for (const g of LABEL_GROUPS) {
    const item = g.items.find(i => i.id === id);
    if (item) return item.default;
  }
  return '';
}
