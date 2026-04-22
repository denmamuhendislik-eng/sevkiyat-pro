import React, { useState, useMemo, useRef } from 'react';
import { AlertTriangle, Check, Edit3, X, ChevronDown, ChevronRight, ExternalLink, RotateCcw, Search, ArrowUpDown, Circle, MessageSquare } from 'lucide-react';

const ORDERS_DATA = [
  {"id":"338478_00232884","customerCode":"120-116-1","customerName":"LALAHAN-ROKETSAN ROKET SANAYİ VE TİCARET A.Ş","orderDate":"2025-11-25","belgeNo":338478,"stokKodu":"00232884","stokAdi":"DINAMIK SIZDIRMAZLIK TEST DUZENEGI GOVDE ARKA KAPK","teslimTarihi":"2025-12-25","brm":"AD","orijinalMiktar":1,"sevkEdilen":0,"kalanMiktar":1,"fiyat":36501.668,"recentlyChanged":false},
  {"id":"338478_00313975","customerCode":"120-116-1","customerName":"LALAHAN-ROKETSAN ROKET SANAYİ VE TİCARET A.Ş","orderDate":"2025-11-25","belgeNo":338478,"stokKodu":"00313975","stokAdi":"MODEL L SOĞUTMALI PİNTLE TİP","teslimTarihi":"2025-12-25","brm":"AD","orijinalMiktar":10,"sevkEdilen":0,"kalanMiktar":10,"fiyat":6154.351,"recentlyChanged":false},
  {"id":"13664_MM-9111-1622","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2025-01-17","belgeNo":13664,"stokKodu":"MM-9111-1622","stokAdi":"CUBUK PSZCL MOTR SBTLME SARP NSV DUAL","teslimTarihi":"2026-01-10","brm":"AD","orijinalMiktar":30,"sevkEdilen":0,"kalanMiktar":30,"fiyat":184.40084,"recentlyChanged":false},
  {"id":"17187_MM-7944-0209","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2025-07-24","belgeNo":17187,"stokKodu":"MM-7944-0209","stokAdi":"PIM PSZCL CAP12.83X12XM10X16 AAS STR","teslimTarihi":"2026-02-01","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":545.9535,"recentlyChanged":false},
  {"id":"18350258_152-2205","customerCode":"120-115","customerName":"DENMA DIŞ TİCARET LİMİTED ŞİRKETİ","orderDate":"2026-02-09","belgeNo":18350258,"stokKodu":"152-2205","stokAdi":"D804590 AHŞAP MODEL YAPIMI","teslimTarihi":"2026-02-09","brm":"TAKIM","orijinalMiktar":1,"sevkEdilen":0,"kalanMiktar":1,"fiyat":25125.4735,"recentlyChanged":false},
  {"id":"18370730_152-2199","customerCode":"120-115","customerName":"DENMA DIŞ TİCARET LİMİTED ŞİRKETİ","orderDate":"2026-02-27","belgeNo":18370730,"stokKodu":"152-2199","stokAdi":"D8040216 - 172459 AHŞAP MODEL YAPIMI","teslimTarihi":"2026-02-27","brm":"TAKIM","orijinalMiktar":1,"sevkEdilen":0,"kalanMiktar":1,"fiyat":30046.958,"recentlyChanged":false},
  {"id":"20783_MM-7471-1024","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-01-21","belgeNo":20783,"stokKodu":"MM-7471-1024","stokAdi":"GOVDE DESTEK ALCR MOTOR 400W MNL BSLM","teslimTarihi":"2026-04-15","brm":"AD","orijinalMiktar":20,"sevkEdilen":0,"kalanMiktar":20,"fiyat":5626.907,"recentlyChanged":true},
  {"id":"21115_MM-9126-0111_KNM5","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-01-26","belgeNo":21115,"stokKodu":"MM-9126-0111_KNM5","stokAdi":"BRAKET ALCR DURDURUCU HSY","teslimTarihi":"2026-04-19","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":1990.9444,"recentlyChanged":false},
  {"id":"21559_MM-9111-1482a","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-1482","stokAdi":"PIM PSZCL SEKTOR MERKEZLEME NSV DUAL","teslimTarihi":"2026-05-04","brm":"AD","orijinalMiktar":50,"sevkEdilen":0,"kalanMiktar":50,"fiyat":114.38076,"recentlyChanged":false},
  {"id":"22284_MM-9111-0999","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-13","belgeNo":22284,"stokKodu":"MM-9111-0999","stokAdi":"MIL PSZCL/SOX TETIK DUSURME UZUN IG","teslimTarihi":"2026-05-14","brm":"AD","orijinalMiktar":1,"sevkEdilen":0,"kalanMiktar":1,"fiyat":521.77203,"recentlyChanged":true},
  {"id":"21737_MM-9111-0962","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21737,"stokKodu":"MM-9111-0962","stokAdi":"PLAKA ALCR/SY SOLENOID BRKET ARLYC IG","teslimTarihi":"2026-05-15","brm":"AD","orijinalMiktar":7,"sevkEdilen":0,"kalanMiktar":7,"fiyat":771.92973,"recentlyChanged":false},
  {"id":"21737_MM-9111-0107","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21737,"stokKodu":"MM-9111-0107","stokAdi":"PIM PSZCL KAIDE MERKEZLEME","teslimTarihi":"2026-05-15","brm":"AD","orijinalMiktar":21,"sevkEdilen":0,"kalanMiktar":21,"fiyat":120.5178,"recentlyChanged":false},
  {"id":"21559_MM-9111-0664","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-0664","stokAdi":"PARCA ALCR/SY KABLO TUTUCU YAN","teslimTarihi":"2026-05-15","brm":"AD","orijinalMiktar":24,"sevkEdilen":0,"kalanMiktar":24,"fiyat":219.963,"recentlyChanged":false},
  {"id":"21559_MM-9111-0477a","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-0477","stokAdi":"PARCA ALCR YUK ENC STATOR TUTUCU SARP","teslimTarihi":"2026-05-15","brm":"AD","orijinalMiktar":24,"sevkEdilen":0,"kalanMiktar":24,"fiyat":990.71335,"recentlyChanged":false},
  {"id":"21559_MM-9111-1022","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-1022","stokAdi":"KAPAK ALCR/SY NAKLIYE YAN IG","teslimTarihi":"2026-05-15","brm":"AD","orijinalMiktar":24,"sevkEdilen":0,"kalanMiktar":24,"fiyat":276.71345,"recentlyChanged":false},
  {"id":"18370730_D8040216","customerCode":"120-115","customerName":"DENMA DIŞ TİCARET LİMİTED ŞİRKETİ","orderDate":"2026-02-27","belgeNo":18370730,"stokKodu":"D8040216","stokAdi":"SUPPORT - PIECE OF CONNECTION","teslimTarihi":"2026-05-25","brm":"AD","orijinalMiktar":100,"sevkEdilen":0,"kalanMiktar":100,"fiyat":398.89927,"recentlyChanged":false},
  {"id":"21500_MM-9111-1189","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-02-20","belgeNo":21500,"stokKodu":"MM-9111-1189","stokAdi":"PARÇA ALOX/SY BAĞLANTI ÜST ÖN DUAL","teslimTarihi":"2026-06-01","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":1750.8,"recentlyChanged":false},
  {"id":"21500_MM-9111-1182","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-02-20","belgeNo":21500,"stokKodu":"MM-9111-1182","stokAdi":"PARÇA ALOX/SY BAĞLANTI ÜST ARKA DUAL","teslimTarihi":"2026-06-01","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":502.4796,"recentlyChanged":false},
  {"id":"21559_MM-9111-0477b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-0477","stokAdi":"PARCA ALCR YUK ENC STATOR TUTUCU SARP","teslimTarihi":"2026-06-12","brm":"AD","orijinalMiktar":20,"sevkEdilen":0,"kalanMiktar":20,"fiyat":990.71335,"recentlyChanged":false},
  {"id":"21559_MM-9111-1318a","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-1318","stokAdi":"BRAKET 7.62MM MAYON YOLU","teslimTarihi":"2026-06-12","brm":"AD","orijinalMiktar":20,"sevkEdilen":0,"kalanMiktar":20,"fiyat":1647.52287,"recentlyChanged":false},
  {"id":"22194_AC-A9111-0001a","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-06","belgeNo":22194,"stokKodu":"AC-A9111-0001","stokAdi":"TAKIM BRAKET YUK MOTOR SARP DUAL","teslimTarihi":"2026-06-19","brm":"AD","orijinalMiktar":7,"sevkEdilen":0,"kalanMiktar":7,"fiyat":16468.959,"recentlyChanged":true},
  {"id":"21559_MM-9111-1482b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-1482","stokAdi":"PIM PSZCL SEKTOR MERKEZLEME NSV DUAL","teslimTarihi":"2026-07-03","brm":"AD","orijinalMiktar":60,"sevkEdilen":0,"kalanMiktar":60,"fiyat":114.38076,"recentlyChanged":false},
  {"id":"21559_MM-9111-0971a","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-0971","stokAdi":"PIM PSZCL BRAKET SOLENOID SARP IG","teslimTarihi":"2026-07-10","brm":"AD","orijinalMiktar":50,"sevkEdilen":0,"kalanMiktar":50,"fiyat":122.29943,"recentlyChanged":false},
  {"id":"21500_MM-9111-1022b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-02-20","belgeNo":21500,"stokKodu":"MM-9111-1022","stokAdi":"KAPAK ALCR/SY NAKLIYE YAN IG","teslimTarihi":"2026-07-10","brm":"AD","orijinalMiktar":25,"sevkEdilen":0,"kalanMiktar":25,"fiyat":275.3133,"recentlyChanged":false},
  {"id":"89_MM-7570-0321","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-13","belgeNo":89,"stokKodu":"MM-7570-0321","stokAdi":"PIM PSZCL 4X16","teslimTarihi":"2026-08-10","brm":"AD","orijinalMiktar":32,"sevkEdilen":0,"kalanMiktar":32,"fiyat":321.5622,"recentlyChanged":false},
  {"id":"89_MM-9115-0469","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-13","belgeNo":89,"stokKodu":"MM-9115-0469","stokAdi":"KAPAK ALCR GGR DIS KAIDE SAG STAMP2","teslimTarihi":"2026-08-10","brm":"AD","orijinalMiktar":8,"sevkEdilen":0,"kalanMiktar":8,"fiyat":11187.96296,"recentlyChanged":false},
  {"id":"150_MM-9111-0971","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-01","belgeNo":150,"stokKodu":"MM-9111-0971","stokAdi":"PIM PSZCL BRAKET SOLENOID SARP IG","teslimTarihi":"2026-08-15","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":123.64356,"recentlyChanged":false},
  {"id":"18350258_D8204297","customerCode":"120-115","customerName":"DENMA DIŞ TİCARET LİMİTED ŞİRKETİ","orderDate":"2026-02-09","belgeNo":18350258,"stokKodu":"D8204297","stokAdi":"BUCKET AND TIPPING LINK","teslimTarihi":"2026-08-25","brm":"AD","orijinalMiktar":51,"sevkEdilen":0,"kalanMiktar":51,"fiyat":1103.44863,"recentlyChanged":false},
  {"id":"22194_AC-9111-0077","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-06","belgeNo":22194,"stokKodu":"AC-9111-0077","stokAdi":"TAKIM TETIK DUSURME SARP IG","teslimTarihi":"2026-10-09","brm":"AD","orijinalMiktar":25,"sevkEdilen":0,"kalanMiktar":25,"fiyat":25504.6311,"recentlyChanged":true},
  {"id":"21559_MM-9111-0477c","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-06","belgeNo":21559,"stokKodu":"MM-9111-0477","stokAdi":"PARCA ALCR YUK ENC STATOR TUTUCU SARP","teslimTarihi":"2026-10-09","brm":"AD","orijinalMiktar":30,"sevkEdilen":0,"kalanMiktar":30,"fiyat":990.71335,"recentlyChanged":false},
  {"id":"22231_MM-9116-0056","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-09","belgeNo":22231,"stokKodu":"MM-9116-0056","stokAdi":"ADAPTOR PSZCL/KFY MOTOR YAN STAMP 2L","teslimTarihi":"2026-10-15","brm":"AD","orijinalMiktar":2,"sevkEdilen":0,"kalanMiktar":2,"fiyat":6234.592,"recentlyChanged":false},
  {"id":"21602_AC-A9111-0001b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-17","belgeNo":21602,"stokKodu":"AC-A9111-0001","stokAdi":"TAKIM BRAKET YUK MOTOR SARP DUAL","teslimTarihi":"2026-12-10","brm":"AD","orijinalMiktar":30,"sevkEdilen":0,"kalanMiktar":30,"fiyat":16277.262,"recentlyChanged":false},
  {"id":"22231_MM-9111-0971b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-04-09","belgeNo":22231,"stokKodu":"MM-9111-0971","stokAdi":"PIM PSZCL BRAKET SOLENOID SARP IG","teslimTarihi":"2026-12-15","brm":"AD","orijinalMiktar":26,"sevkEdilen":0,"kalanMiktar":26,"fiyat":123.80118,"recentlyChanged":false},
  {"id":"19887_MM-9111-1318b","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2025-11-27","belgeNo":19887,"stokKodu":"MM-9111-1318","stokAdi":"BRAKET 7.62MM MAYON YOLU","teslimTarihi":"2027-01-04","brm":"AD","orijinalMiktar":40,"sevkEdilen":0,"kalanMiktar":40,"fiyat":1589.15705,"recentlyChanged":false},
  {"id":"21602_AC-A9111-0001c","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2026-03-17","belgeNo":21602,"stokKodu":"AC-A9111-0001","stokAdi":"TAKIM BRAKET YUK MOTOR SARP DUAL","teslimTarihi":"2027-01-10","brm":"AD","orijinalMiktar":25,"sevkEdilen":0,"kalanMiktar":25,"fiyat":16277.262,"recentlyChanged":false},
  {"id":"19887_MM-9111-0041","customerCode":"120-0107","customerName":"ASELSAN KONYA SİLAH SİSTEMLERİ ANONİM ŞİRKETİ","orderDate":"2025-11-27","belgeNo":19887,"stokKodu":"MM-9111-0041","stokAdi":"PUL PSZCL/SOX KONIK BRS","teslimTarihi":"2028-01-01","brm":"AD","orijinalMiktar":80,"sevkEdilen":0,"kalanMiktar":80,"fiyat":106.08525,"recentlyChanged":false}
];

const TODAY = new Date('2026-04-21T00:00:00');

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getWeekMonday(isoWeek) {
  const [y, w] = isoWeek.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7);
  return target;
}

function getWeekRange(isoWeek) {
  const mon = getWeekMonday(isoWeek);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  return { start: mon, end: sun };
}

function weeksBetween(w1, w2) {
  // w1 ve w2 arasındaki tam hafta farkı (w1 < w2 ise negatif değer döner "w1 geç" için pozitif olsun diye ters çevir)
  const m1 = getWeekMonday(w1);
  const m2 = getWeekMonday(w2);
  return Math.round((m2 - m1) / (7 * 86400000));
}

function formatDateShort(date) {
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  const days = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function getMonthLabel(date) {
  const months = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function getMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shortMonthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${months[m-1]} ${String(y).slice(2)}`;
}

function formatMoney(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toFixed(0);
}

function formatMoneyFull(n) {
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function calcRowTotal(order) {
  return order.fiyat * order.kalanMiktar;
}

function effectiveWeek(order, overrides) {
  if (overrides[order.id]) return overrides[order.id].plannedWeek;
  return getISOWeek(new Date(order.teslimTarihi + 'T00:00:00Z'));
}

function isLate(order, overrides, currentWeek) {
  return effectiveWeek(order, overrides) < currentWeek;
}

function shortName(fullName) {
  if (!fullName) return '';
  if (fullName.includes('ASELSAN')) return 'Aselsan Konya';
  if (fullName.includes('ROKETSAN')) return 'Roketsan';
  if (fullName.includes('DENMA')) return 'Denma Dış Ticaret';
  return fullName.slice(0, 30);
}

function customerBadge(code) {
  if (code === '120-0107') return { bg: '#1e293b', fg: '#f1f5f9', label: 'ASL' };
  if (code === '120-116-1') return { bg: '#78350f', fg: '#fef3c7', label: 'RKT' };
  if (code === '120-115') return { bg: '#064e3b', fg: '#d1fae5', label: 'DNM' };
  return { bg: '#475569', fg: '#fff', label: '?' };
}

// Ana bileşen
export default function DigerMusterilerPrototipV2() {
  const currentWeek = getISOWeek(TODAY);
  const [overrides, setOverrides] = useState({});
  const [customerFilter, setCustomerFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortMode, setSortMode] = useState('date'); // date | price | customer
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [notingOrderId, setNotingOrderId] = useState(null);
  const [draggedOrderId, setDraggedOrderId] = useState(null);
  const [hoveredWeek, setHoveredWeek] = useState(null);
  const [toast, setToast] = useState(null);

  const weeks = useMemo(() => {
    const list = [];
    const startMon = getWeekMonday(currentWeek);
    startMon.setUTCDate(startMon.getUTCDate() - 7);
    for (let i = 0; i < 52; i++) {
      const mon = new Date(startMon);
      mon.setUTCDate(startMon.getUTCDate() + i * 7);
      list.push(getISOWeek(mon));
    }
    return list;
  }, [currentWeek]);

  const filteredOrders = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return ORDERS_DATA.filter(o => {
      if (customerFilter !== 'all' && o.customerCode !== customerFilter) return false;
      if (q) {
        const hay = `${o.stokKodu} ${o.stokAdi} ${o.belgeNo}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [customerFilter, searchText]);

  const ordersByWeek = useMemo(() => {
    const map = {};
    const late = [];
    for (const o of filteredOrders) {
      if (isLate(o, overrides, currentWeek)) {
        late.push(o);
      } else {
        const w = effectiveWeek(o, overrides);
        if (!map[w]) map[w] = [];
        map[w].push(o);
      }
    }
    // Hafta içinde sırala
    const sortFn = (a, b) => {
      if (sortMode === 'price') return calcRowTotal(b) - calcRowTotal(a);
      if (sortMode === 'customer') return (a.customerCode || '').localeCompare(b.customerCode || '') || a.teslimTarihi.localeCompare(b.teslimTarihi);
      // date (default) — belge no'ları bir arada tutmak için önce teslim, sonra belgeNo
      return a.teslimTarihi.localeCompare(b.teslimTarihi) || String(a.belgeNo).localeCompare(String(b.belgeNo));
    };
    Object.keys(map).forEach(w => map[w].sort(sortFn));
    late.sort(sortFn);
    return { byWeek: map, late };
  }, [filteredOrders, overrides, currentWeek, sortMode]);

  // Bu hafta siparişleri
  const thisWeekOrders = ordersByWeek.byWeek[currentWeek] || [];

  // KPI + aylık bedeller
  const stats = useMemo(() => {
    const total = filteredOrders.reduce((s, o) => s + calcRowTotal(o), 0);
    const lateVal = ordersByWeek.late.reduce((s, o) => s + calcRowTotal(o), 0);
    const nextWeekKey = weeks[2];
    const nextWeekOrders = ordersByWeek.byWeek[nextWeekKey] || [];
    const nextWeekVal = nextWeekOrders.reduce((s, o) => s + calcRowTotal(o), 0);
    return {
      totalOrders: filteredOrders.length,
      totalVal: total,
      lateCount: ordersByWeek.late.length,
      lateVal,
      nextWeekCount: nextWeekOrders.length,
      nextWeekVal,
      overrideCount: Object.keys(overrides).length
    };
  }, [filteredOrders, ordersByWeek, overrides, weeks]);

  // Aylık bedeller
  const monthlyTotals = useMemo(() => {
    const totals = {};
    for (const o of filteredOrders) {
      const w = effectiveWeek(o, overrides);
      if (w < currentWeek) continue; // geciken hariç
      const mon = getWeekMonday(w);
      const key = getMonthKey(mon);
      if (!totals[key]) totals[key] = { count: 0, value: 0 };
      totals[key].count++;
      totals[key].value += calcRowTotal(o);
    }
    // 12 aylık pencere
    const months = [];
    const base = new Date(TODAY);
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1));
      const key = getMonthKey(d);
      months.push({ key, label: shortMonthLabel(key), ...(totals[key] || { count: 0, value: 0 }) });
    }
    return months;
  }, [filteredOrders, overrides, currentWeek]);

  const handleMoveOrder = (orderId, newWeek, note) => {
    const order = ORDERS_DATA.find(o => o.id === orderId);
    if (!order) return;
    const origWeek = getISOWeek(new Date(order.teslimTarihi + 'T00:00:00Z'));
    if (newWeek === origWeek && !note) {
      setOverrides(prev => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      setToast({ msg: `${order.stokKodu} → orijinal haftasına döndü`, tone: 'info' });
    } else {
      setOverrides(prev => ({
        ...prev,
        [orderId]: {
          plannedWeek: newWeek,
          note: note ?? prev[orderId]?.note ?? '',
          by: 'Ömer',
          at: new Date().toISOString(),
          origWeek
        }
      }));
      setToast({ msg: `${order.stokKodu} → ${newWeek}${note ? ' · not kaydedildi' : ''}`, tone: 'success' });
    }
    setTimeout(() => setToast(null), 2400);
    setEditingOrderId(null);
  };

  const handleSaveNote = (orderId, note) => {
    const order = ORDERS_DATA.find(o => o.id === orderId);
    if (!order) return;
    const existing = overrides[orderId];
    if (!existing) {
      // Henüz override yok, orijinal haftayla override oluştur
      const origWeek = getISOWeek(new Date(order.teslimTarihi + 'T00:00:00Z'));
      if (!note.trim()) {
        setNotingOrderId(null);
        return;
      }
      setOverrides(prev => ({
        ...prev,
        [orderId]: {
          plannedWeek: origWeek,
          note: note.trim(),
          by: 'Ömer',
          at: new Date().toISOString(),
          origWeek
        }
      }));
    } else {
      if (!note.trim() && existing.plannedWeek === existing.origWeek) {
        // Override anlamsız hale geldi, kaldır
        setOverrides(prev => {
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      } else {
        setOverrides(prev => ({
          ...prev,
          [orderId]: { ...prev[orderId], note: note.trim(), at: new Date().toISOString() }
        }));
      }
    }
    setToast({ msg: `Not kaydedildi`, tone: 'success' });
    setTimeout(() => setToast(null), 1800);
    setNotingOrderId(null);
  };

  const handleDragStart = (e, orderId) => {
    setDraggedOrderId(orderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, week) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoveredWeek(week);
  };

  const handleDrop = (e, week) => {
    e.preventDefault();
    if (draggedOrderId) handleMoveOrder(draggedOrderId, week);
    setDraggedOrderId(null);
    setHoveredWeek(null);
  };

  const handleDragEnd = () => {
    setDraggedOrderId(null);
    setHoveredWeek(null);
  };

  const stripWeeks = weeks.slice(1, 13);
  const mainStyle = {
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
    background: '#fafaf9',
    color: '#1c1917',
    minHeight: '100vh',
    fontSize: '13px'
  };

  return (
    <div style={mainStyle}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 100,
          background: toast.tone === 'success' ? '#166534' : '#1e293b',
          color: '#fff', padding: '10px 16px', borderRadius: 4,
          fontSize: 12, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: '#78716c', letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 500 }}>
            Sevkiyat Pro · v18.18 Prototip v2
          </div>
          <div style={{ fontSize: 10, color: '#a8a29e', fontFamily: "'IBM Plex Mono', monospace" }}>
            {currentWeek} · {formatDateFull('2026-04-21')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: -0.3 }}>
            Diğer Müşteriler — Sipariş Planlama
          </h1>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Arama */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f5f4', padding: '5px 10px', borderRadius: 3 }}>
              <Search size={12} color="#78716c" />
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Stok kodu, ad, belge no..."
                style={{
                  border: 'none', background: 'transparent', outline: 'none',
                  fontSize: 12, fontFamily: 'inherit', width: 180
                }}
              />
              {searchText && (
                <button onClick={() => setSearchText('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X size={12} color="#78716c" />
                </button>
              )}
            </div>

            {/* Sıralama */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ArrowUpDown size={12} color="#78716c" />
              <select value={sortMode} onChange={e => setSortMode(e.target.value)} style={{
                padding: '5px 8px', border: '1px solid #d6d3d1', background: '#fff',
                fontSize: 12, fontFamily: 'inherit', borderRadius: 3, cursor: 'pointer'
              }}>
                <option value="date">Tarih</option>
                <option value="price">Tutar</option>
                <option value="customer">Müşteri</option>
              </select>
            </div>

            {/* Müşteri filtresi */}
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} style={{
              padding: '6px 10px', border: '1px solid #d6d3d1', background: '#fff',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 500, borderRadius: 3,
              cursor: 'pointer', minWidth: 200
            }}>
              <option value="all">Tüm müşteriler ({ORDERS_DATA.length})</option>
              <option value="120-0107">Aselsan Konya ({ORDERS_DATA.filter(o => o.customerCode === '120-0107').length})</option>
              <option value="120-115">Denma Dış Ticaret ({ORDERS_DATA.filter(o => o.customerCode === '120-115').length})</option>
              <option value="120-116-1">Roketsan ({ORDERS_DATA.filter(o => o.customerCode === '120-116-1').length})</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '12px 24px', display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <Stat label="Aktif sipariş" value={stats.totalOrders} sub={`₺ ${formatMoneyFull(stats.totalVal)}`} />
        <Stat label="Geciken" value={stats.lateCount} sub={stats.lateVal > 0 ? `₺ ${formatMoneyFull(stats.lateVal)}` : null} tone={stats.lateCount > 0 ? 'alert' : null} />
        <Stat label="Gelecek hafta" value={stats.nextWeekCount} sub={stats.nextWeekVal > 0 ? `₺ ${formatMoneyFull(stats.nextWeekVal)}` : '—'} />
        <Stat label="Manuel override" value={stats.overrideCount} tone={stats.overrideCount > 0 ? 'override' : null} />
      </div>

      {/* Aylık bedel şeridi */}
      <div style={{ background: '#fafaf9', borderBottom: '1px solid #e7e5e4', padding: '10px 24px' }}>
        <div style={{ fontSize: 10, color: '#78716c', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 500, marginBottom: 6 }}>
          Aylık Toplam Teslim Bedeli (12 Ay)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
          {monthlyTotals.map(m => {
            const isActive = m.value > 0;
            return (
              <div key={m.key} style={{
                padding: '6px 6px',
                background: isActive ? '#fff' : '#f5f5f4',
                border: '1px solid ' + (isActive ? '#e7e5e4' : 'transparent'),
                borderRadius: 2,
                textAlign: 'center',
                minWidth: 0
              }}>
                <div style={{ fontSize: 10, color: '#78716c', fontWeight: 500 }}>{m.label}</div>
                <div style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12,
                  fontWeight: 600,
                  color: isActive ? '#1c1917' : '#d6d3d1',
                  marginTop: 2
                }}>
                  {isActive ? `₺${formatMoney(m.value)}` : '—'}
                </div>
                {isActive && (
                  <div style={{ fontSize: 9, color: '#a8a29e', marginTop: 1, fontFamily: "'IBM Plex Mono', monospace" }}>
                    {m.count} sip
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hafta stripi */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e7e5e4', padding: '14px 24px' }}>
        <div style={{ fontSize: 10, color: '#78716c', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 500, marginBottom: 8 }}>
          Haftalar — Bugünden 12 Hafta
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4 }}>
          {stripWeeks.map(w => {
            const { start } = getWeekRange(w);
            const orders = ordersByWeek.byWeek[w] || [];
            const weekVal = orders.reduce((s, o) => s + calcRowTotal(o), 0);
            const isCurrent = w === currentWeek;
            const isHovered = hoveredWeek === w;
            const count = orders.length;
            return (
              <div key={w}
                onDragOver={e => handleDragOver(e, w)}
                onDragLeave={() => setHoveredWeek(null)}
                onDrop={e => handleDrop(e, w)}
                onClick={() => document.getElementById('week-' + w)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{
                  padding: '8px 6px',
                  border: isCurrent ? '2px solid #1e293b' : isHovered ? '2px dashed #0891b2' : '1px solid #e7e5e4',
                  background: isHovered ? '#ecfeff' : isCurrent ? '#f1f5f9' : count > 0 ? '#fff' : '#fafaf9',
                  borderRadius: 3,
                  cursor: 'pointer',
                  minWidth: 0,
                  textAlign: 'center',
                  transition: 'all 0.12s',
                  position: 'relative'
                }}>
                <div style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: isCurrent ? '#1e293b' : '#78716c', fontWeight: isCurrent ? 600 : 400, letterSpacing: 0.2 }}>
                  {w.split('-W')[1]}
                </div>
                <div style={{ fontSize: 9, color: '#a8a29e', marginTop: 1 }}>{formatDateShort(start)}</div>
                {count > 0 ? (
                  <>
                    <div style={{ marginTop: 3, fontSize: 14, fontWeight: 600, color: isCurrent ? '#1e293b' : '#292524', fontFamily: "'IBM Plex Mono', monospace" }}>{count}</div>
                    <div style={{ fontSize: 9, color: '#78716c', fontFamily: "'IBM Plex Mono', monospace", marginTop: 1 }}>₺{formatMoney(weekVal)}</div>
                  </>
                ) : (
                  <div style={{ marginTop: 3, fontSize: 14, color: '#d6d3d1' }}>·</div>
                )}
                {isCurrent && (
                  <div style={{ position: 'absolute', top: -1, right: -1, background: '#1e293b', color: '#fff', fontSize: 8, padding: '1px 4px', borderRadius: '0 2px 0 2px', fontWeight: 600, letterSpacing: 0.3 }}>
                    BU HAFTA
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: '#a8a29e', marginTop: 8, fontStyle: 'italic' }}>
          Haftaya tıkla → detaya kaydır · Siparişi sürükle → haftaya bırak
        </div>
      </div>

      {/* Bu hafta öncelikli vurgu */}
      {thisWeekOrders.length > 0 && (
        <div style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', padding: '14px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ background: '#1e293b', color: '#fff', padding: '2px 7px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, borderRadius: 2 }}>BU HAFTA</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Sevke Hazır Olması Gereken ({thisWeekOrders.length})
            </span>
            <span style={{ fontSize: 11, color: '#475569', fontFamily: "'IBM Plex Mono', monospace" }}>
              · ₺ {formatMoneyFull(thisWeekOrders.reduce((s, o) => s + calcRowTotal(o), 0))}
            </span>
          </div>
          <OrderGroup
            orders={thisWeekOrders}
            overrides={overrides}
            editingOrderId={editingOrderId}
            setEditingOrderId={setEditingOrderId}
            notingOrderId={notingOrderId}
            setNotingOrderId={setNotingOrderId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onMove={handleMoveOrder}
            onSaveNote={handleSaveNote}
            weeks={weeks}
            currentWeek={currentWeek}
          />
        </div>
      )}

      {/* Gecikenler */}
      {ordersByWeek.late.length > 0 && (
        <div style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca', padding: '14px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <AlertTriangle size={14} color="#991b1b" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#991b1b', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Gecikenler ({ordersByWeek.late.length})
            </span>
            <span style={{ fontSize: 11, color: '#b91c1c', fontFamily: "'IBM Plex Mono', monospace" }}>
              · ₺ {formatMoneyFull(stats.lateVal)}
            </span>
            <span style={{ fontSize: 11, color: '#b91c1c' }}>
              · Bir haftaya sürükle veya dropdown'dan taşı
            </span>
          </div>
          <OrderGroup
            orders={ordersByWeek.late}
            overrides={overrides}
            editingOrderId={editingOrderId}
            setEditingOrderId={setEditingOrderId}
            notingOrderId={notingOrderId}
            setNotingOrderId={setNotingOrderId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onMove={handleMoveOrder}
            onSaveNote={handleSaveNote}
            weeks={weeks}
            currentWeek={currentWeek}
            variant="late"
          />
        </div>
      )}

      {/* Detay — haftalara göre */}
      <div style={{ padding: '14px 24px 48px' }}>
        {weeks.slice(2).map(w => {
          const orders = ordersByWeek.byWeek[w] || [];
          if (orders.length === 0) return null;
          const { start, end } = getWeekRange(w);
          const weekVal = orders.reduce((s, o) => s + calcRowTotal(o), 0);
          return (
            <div key={w} id={'week-' + w} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 6, borderBottom: '1px solid #e7e5e4', marginBottom: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace", color: '#292524' }}>
                  {w}
                </div>
                <div style={{ fontSize: 12, color: '#57534e' }}>
                  {formatDateShort(start)} — {formatDateShort(end)}
                </div>
                <div style={{ fontSize: 11, color: '#a8a29e' }}>· {getMonthLabel(start)}</div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: '#78716c', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {orders.length} sipariş · ₺ {formatMoneyFull(weekVal)}
                </div>
              </div>
              <div onDragOver={e => handleDragOver(e, w)} onDragLeave={() => setHoveredWeek(null)} onDrop={e => handleDrop(e, w)}
                style={{
                  background: hoveredWeek === w ? '#ecfeff' : 'transparent',
                  padding: hoveredWeek === w ? 4 : 0,
                  borderRadius: 3,
                  transition: 'all 0.1s'
                }}>
                <OrderGroup
                  orders={orders}
                  overrides={overrides}
                  editingOrderId={editingOrderId}
                  setEditingOrderId={setEditingOrderId}
                  notingOrderId={notingOrderId}
                  setNotingOrderId={setNotingOrderId}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onMove={handleMoveOrder}
                  onSaveNote={handleSaveNote}
                  weeks={weeks}
                  currentWeek={currentWeek}
                />
              </div>
            </div>
          );
        })}

        <div style={{ marginTop: 32, padding: '14px 0', borderTop: '1px solid #e7e5e4', fontSize: 11, color: '#a8a29e', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, color: '#78716c', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Prototip v2 — Yenilikler
          </div>
          <strong>• Toplam bedeller</strong> (₺ TL) — satır, belge grubu, hafta, ay, KPI · <strong>• Aylık bedel şeridi</strong> (12 ay) · <strong>• Bu hafta vurgu bloğu</strong> (sevke hazır olmalı) · <strong>• Sipariş no gruplaması</strong> (aynı belge no → hafif gri çerçeve) · <strong>• Geciken gecikme süresi rozeti</strong> (🕐 N hafta geç) · <strong>• Arama</strong> (stok kodu / ad / belge no) · <strong>• Sıralama</strong> (tarih / tutar / müşteri) · <strong>• VIO güncellemesi rozeti</strong> (mavi nokta, son import'ta değişenler) · <strong>• Override notu</strong> (✎ ikonu → küçük metin, hover'da gösterim)
          <br />
          <em>Faz 2'de gelecekler:</em> motor entegrasyonu, sipariş bazlı ihtiyaç paneli (eksik bileşenler), kapasite çakışması, döviz görünümü, override stale uyarısı.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'alert' ? '#991b1b' : tone === 'override' ? '#92400e' : '#1c1917';
  return (
    <div>
      <div style={{ fontSize: 10, color: '#a8a29e', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10, color: '#78716c', fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}

// Siparişleri belge no'ya göre grupla ve render et
function OrderGroup({ orders, overrides, editingOrderId, setEditingOrderId, notingOrderId, setNotingOrderId, onDragStart, onDragEnd, onMove, onSaveNote, weeks, currentWeek, variant }) {
  // Aynı belge no'lu olanları sıralı gruplara ayır. Sıra orijinal sırayı korur.
  const groups = useMemo(() => {
    const result = [];
    const seen = new Map();
    for (const o of orders) {
      const key = String(o.belgeNo);
      if (!seen.has(key)) {
        const arr = [];
        seen.set(key, arr);
        result.push({ belgeNo: o.belgeNo, items: arr });
      }
      seen.get(key).push(o);
    }
    return result;
  }, [orders]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {groups.map(g => {
        const hasMultiple = g.items.length > 1;
        const groupTotal = g.items.reduce((s, o) => s + calcRowTotal(o), 0);
        return (
          <div key={g.belgeNo} style={{
            background: hasMultiple ? '#fafaf9' : 'transparent',
            border: hasMultiple ? '1px solid #e7e5e4' : 'none',
            borderRadius: hasMultiple ? 3 : 0,
            padding: hasMultiple ? '4px 5px' : 0
          }}>
            {hasMultiple && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 4px', fontSize: 10, color: '#78716c' }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 600,
                  color: '#57534e',
                  background: '#fff',
                  padding: '1px 6px',
                  borderRadius: 2,
                  border: '1px solid #e7e5e4',
                  letterSpacing: 0.3
                }}>
                  Belge #{g.belgeNo}
                </span>
                <span>{g.items.length} kalem · ₺ {formatMoneyFull(groupTotal)}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {g.items.map(o => (
                <OrderRow
                  key={o.id}
                  order={o}
                  overrides={overrides}
                  editingOrderId={editingOrderId}
                  setEditingOrderId={setEditingOrderId}
                  notingOrderId={notingOrderId}
                  setNotingOrderId={setNotingOrderId}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onMove={onMove}
                  onSaveNote={onSaveNote}
                  weeks={weeks}
                  currentWeek={currentWeek}
                  variant={variant}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderRow({ order, overrides, editingOrderId, setEditingOrderId, notingOrderId, setNotingOrderId, onDragStart, onDragEnd, onMove, onSaveNote, weeks, currentWeek, variant }) {
  const isEditing = editingOrderId === order.id;
  const isNoting = notingOrderId === order.id;
  const override = overrides[order.id];
  const origWeek = getISOWeek(new Date(order.teslimTarihi + 'T00:00:00Z'));
  const effWeek = override?.plannedWeek || origWeek;
  const badge = customerBadge(order.customerCode);
  const isLateRow = variant === 'late';
  const lateBy = isLateRow ? weeksBetween(effWeek, currentWeek) : 0;
  const rowTotal = calcRowTotal(order);
  const hasNote = !!override?.note;

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, order.id)}
      onDragEnd={onDragEnd}
      style={{
        display: 'grid',
        gridTemplateColumns: '26px 170px 1fr 80px 95px 100px 100px',
        gap: 8,
        alignItems: 'center',
        padding: '7px 9px',
        background: '#fff',
        border: '1px solid ' + (isLateRow ? '#fecaca' : '#e7e5e4'),
        borderLeft: '3px solid ' + (isLateRow ? '#dc2626' : override ? '#d97706' : '#e7e5e4'),
        borderRadius: 2,
        fontSize: 12,
        cursor: 'grab',
        transition: 'background 0.1s'
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
    >
      {/* Müşteri rozeti */}
      <div title={shortName(order.customerName)} style={{
        background: badge.bg, color: badge.fg, fontSize: 9, fontWeight: 600,
        padding: '3px 0', textAlign: 'center', borderRadius: 2, letterSpacing: 0.5,
        fontFamily: "'IBM Plex Mono', monospace"
      }}>
        {badge.label}
      </div>

      {/* Stok kodu + rozetler */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, color: '#1c1917' }}>
          {order.stokKodu}
        </span>
        {order.recentlyChanged && (
          <span title="Son import'ta VIO verisi değişti">
            <Circle size={8} fill="#0891b2" color="#0891b2" />
          </span>
        )}
        {override && (
          <span title={`Ömer tarafından değiştirildi\nOrijinal: ${origWeek}\nYeni: ${override.plannedWeek}${hasNote ? '\n\nNot: ' + override.note : ''}`}>
            <Edit3 size={11} color="#d97706" strokeWidth={2.2} />
          </span>
        )}
        {hasNote && (
          <span title={override.note}>
            <MessageSquare size={10} color="#0891b2" strokeWidth={2.2} />
          </span>
        )}
        {isLateRow && (
          <span style={{
            background: '#991b1b', color: '#fff', fontSize: 9, fontWeight: 600,
            padding: '1px 5px', borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace",
            whiteSpace: 'nowrap'
          }}>
            🕐 {lateBy}h
          </span>
        )}
      </div>

      {/* Stok adı */}
      <div style={{ color: '#57534e', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={order.stokAdi}>
        {order.stokAdi}
      </div>

      {/* Miktar */}
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#292524', textAlign: 'right' }}>
        <span style={{ fontWeight: 600 }}>{order.kalanMiktar}</span>
        <span style={{ color: '#a8a29e', marginLeft: 3 }}>{order.brm}</span>
      </div>

      {/* Bedel */}
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: '#1c1917', textAlign: 'right', fontWeight: 500 }}>
        ₺ {formatMoneyFull(rowTotal)}
      </div>

      {/* Teslim tarihi */}
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: isLateRow ? '#991b1b' : '#57534e', textAlign: 'right', fontWeight: isLateRow ? 600 : 400 }}>
        {formatDateFull(order.teslimTarihi).slice(4)}
      </div>

      {/* Plan haftası + aksiyon */}
      <div style={{ position: 'relative', display: 'flex', gap: 3 }}>
        <button
          onClick={() => setEditingOrderId(isEditing ? null : order.id)}
          style={{
            flex: 1,
            padding: '3px 6px',
            border: '1px solid ' + (override ? '#d97706' : '#d6d3d1'),
            background: override ? '#fef3c7' : '#fff',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 11, fontWeight: 600,
            color: override ? '#92400e' : '#1c1917',
            cursor: 'pointer', borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2
          }}
        >
          <span>{effWeek}</span>
          <ChevronDown size={10} />
        </button>
        <button
          onClick={() => setNotingOrderId(isNoting ? null : order.id)}
          title={hasNote ? 'Not düzenle' : 'Not ekle'}
          style={{
            padding: '3px 5px',
            border: '1px solid ' + (hasNote ? '#0891b2' : '#d6d3d1'),
            background: hasNote ? '#ecfeff' : '#fff',
            cursor: 'pointer', borderRadius: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <MessageSquare size={10} color={hasNote ? '#0891b2' : '#78716c'} />
        </button>

        {isEditing && (
          <WeekPicker
            currentWeek={currentWeek}
            selectedWeek={effWeek}
            origWeek={origWeek}
            weeks={weeks}
            onSelect={w => onMove(order.id, w)}
            onClose={() => setEditingOrderId(null)}
          />
        )}
        {isNoting && (
          <NoteEditor
            existingNote={override?.note || ''}
            onSave={note => onSaveNote(order.id, note)}
            onClose={() => setNotingOrderId(null)}
          />
        )}
      </div>
    </div>
  );
}

function WeekPicker({ currentWeek, selectedWeek, origWeek, weeks, onSelect, onClose }) {
  const nowIdx = weeks.indexOf(currentWeek);
  const visibleWeeks = weeks.slice(Math.max(0, nowIdx - 1), nowIdx + 32);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 4,
        width: 280, maxHeight: 400, overflowY: 'auto',
        background: '#fff', border: '1px solid #d6d3d1', borderRadius: 3,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, padding: 6
      }}>
        <div style={{ fontSize: 10, color: '#78716c', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 500, padding: '6px 8px 4px', borderBottom: '1px solid #e7e5e4', marginBottom: 4 }}>
          Hedef Hafta Seç
        </div>
        {origWeek !== selectedWeek && (
          <button onClick={() => onSelect(origWeek)} style={{
            width: '100%', padding: '8px 10px', background: '#f5f5f4',
            border: '1px dashed #a8a29e', fontFamily: 'inherit', fontSize: 11,
            cursor: 'pointer', borderRadius: 2, marginBottom: 6, color: '#57534e',
            display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center'
          }}>
            <RotateCcw size={11} />
            Orijinale dön ({origWeek})
          </button>
        )}
        {visibleWeeks.map(w => {
          const { start, end } = getWeekRange(w);
          const isSelected = w === selectedWeek;
          const isCurrent = w === currentWeek;
          const isOrig = w === origWeek;
          return (
            <button key={w} onClick={() => onSelect(w)} style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 8px',
              background: isSelected ? '#1e293b' : isCurrent ? '#f1f5f9' : '#fff',
              color: isSelected ? '#fff' : '#1c1917',
              border: 'none', fontFamily: 'inherit', fontSize: 11,
              cursor: 'pointer', borderRadius: 2, textAlign: 'left'
            }}
              onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f5f5f4'; }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isCurrent ? '#f1f5f9' : '#fff'; }}
            >
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, minWidth: 68 }}>{w}</span>
              <span style={{ color: isSelected ? '#cbd5e1' : '#78716c', fontSize: 10, flex: 1 }}>
                {formatDateShort(start)} — {formatDateShort(end)}
              </span>
              {isCurrent && !isSelected && <span style={{ fontSize: 9, color: '#0891b2', fontWeight: 600, letterSpacing: 0.4 }}>BU</span>}
              {isOrig && !isSelected && <span style={{ fontSize: 9, color: '#92400e', fontWeight: 600, letterSpacing: 0.4 }}>ORİJ</span>}
              {isSelected && <Check size={12} />}
            </button>
          );
        })}
      </div>
    </>
  );
}

function NoteEditor({ existingNote, onSave, onClose }) {
  const [value, setValue] = useState(existingNote);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 4,
        width: 280, background: '#fff',
        border: '1px solid #d6d3d1', borderRadius: 3,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, padding: 10
      }}>
        <div style={{ fontSize: 10, color: '#78716c', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 500, marginBottom: 6 }}>
          Planlama Notu
        </div>
        <textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Örn: kapasite sıkıntısı, müşteri ricası, fason gecikmesi..."
          autoFocus
          style={{
            width: '100%', minHeight: 70,
            padding: 8, border: '1px solid #d6d3d1', borderRadius: 2,
            fontFamily: 'inherit', fontSize: 11, resize: 'vertical', outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
          <button onClick={onClose} style={{
            padding: '5px 10px', background: 'none', border: '1px solid #d6d3d1',
            fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 2
          }}>
            İptal
          </button>
          <button onClick={() => onSave(value)} style={{
            padding: '5px 10px', background: '#1e293b', color: '#fff', border: 'none',
            fontSize: 11, fontFamily: 'inherit', fontWeight: 500, cursor: 'pointer', borderRadius: 2
          }}>
            Kaydet
          </button>
        </div>
      </div>
    </>
  );
}
