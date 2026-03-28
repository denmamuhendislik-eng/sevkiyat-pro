import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, ReferenceLine } from "recharts";
import { auth, db } from "./firebase";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import * as XLSX from "xlsx";

const RAW = {"p":[[1,"REDÜKTÖR DİŞLİ TAKIMLARI C54ST.","SET OF PARTS OF REDUCTION GEAR C54ST.",575.0,"#3B8BD4"],[2,"REDÜKTÖR DİŞLİ TAKIMLARI C44ST.","SET OF PARTS OF REDUCTION GEAR C44ST.",356.0,"#1D9E75"],[3,"REDÜKTÖR DİŞLİ TAKIMLARI C38ST.","SET OF PARTS OF REDUCTION GEAR C38ST.",210.0,"#D85A30"],[4,"REDÜKTÖR DİŞLİ TAKIMLARI TP32/36","SET OF PARTS OF REDUCTION GEAR TP32/36",210.0,"#D4537E"],[5,"REDÜKTÖR DİŞLİ TAKIMLARI TP25/32","SET OF PARTS OF REDUCTION GEAR TP25/32",170.0,"#534AB7"],[6,"116521-O 950X817,5X20MM P54EVO ST37 LZR KSM","116521-O 950X817,5X20MM P54EVO ST37 LSR CUT",61.0,"#639922"],[7,"116571-O 725X650X12MM ST37 P34AEVO PLAKA LZR KSM","116571-O 725X650X12MM ST37 P34A PLATE LSR CUT",27.0,"#BA7517"],[8,"116572-O 725X650X12MM TP25/32A ST37 LZR KSM","116572-O 725X650X12MM TP25/32A ST37 LSR CUT",26.0,"#E24B4A"],[9,"121297-F BÜKME AYNASI P34EVO - TP25/32A","121297-F BENDING PLATE P34EVO - TP25/32A",19.5,"#185FA5"],[10,"330910-01 GÖVDE","330910-01 BODY",7.5,"#0F6E56"],[11,"210174 243,50X78X15MM P54A-P56A-P56BEVO LZR KSM","210174 243,50X78X15MM P54A-P56A-P56B EVO LSR CUT",2.0,"#993C1D"],[12,"210185 290X68X15MM LAMA TP25/32 - TP32/36","210185 290X68X15MM SHEET METAL TP32/36",2.0,"#993556"],[13,"210181 222,5X68X12MM LAMA","210181 222,5X68X12MM SUPPORT",1.5,"#5F5E5A"],[14,"210184 205X68X12MM P34AEVO ST37 LZR KSM","210184 205X68X12MM ST37 LSR CUT",1.2,"#854F0B"],[15,"210180 140X68X15MM LAMA TP25/32 - TP32/36","210180 140X68X15MM SHEET METAL TP32/36",1.0,"#3C3489"],[16,"210189 162,5X68X12MM LAMA","210189 162,5X68X12MM SUPPORT",1.0,"#A32D2D"],[17,"210183 70X68X12MM P34AEVO ST37 LZR KSM","210183 70X68X12MM ST37 LSR CUT",0.4,"#3B6D11"],[18,"REDÜKTÖR DİŞLİ TAKIMLARI TP42/45","SET OF PARTS OF REDUCTION GEAR TP42/45",326.0,"#72243E"],[19,"REDÜKTÖR DİŞLİ TAKIMLARI CAL35","SET OF PARTS OF REDUCTION GEAR CAL35",131.0,"#27500A"],[20,"116502 1400X780X15MM P56 BEVO ST37 LZR KSM","116502 1400X780X15MM P56 B EVO ST37 LSR CUT",115.0,"#085041"],[21,"116522 1300X817,5X20MM P56AEVO ST37 LZR KSM","116522 1300X817,5X20MM P56AEVO ST37 LSR CUT",88.0,"#3B8BD4"],[22,"121408-F BÜKME AYNASI P54EVO","121408-F BENDING PLATE P54EVO",65.0,"#1D9E75"],[23,"155003 DÖKÜM ŞANZIMAN KAPAĞI P54EVO","155003 CASTING GEARBOX COVER P54EVO",61.0,"#D85A30"],[24,"116660-O 940X787,50X15MM P44AEVO - TP42/45A ST37 LZR KSM","116660-O 940X787,5X15MM P44AEVO - TP42/45A ST37 LSR CUT",49.0,"#D4537E"],[25,"116602-O 820X697,50X15MM P38AEVO-TP32/36A ST37 LZR KSM","116602-O 820X697,50X15MM P38AEVO-TP32/36A ST37 LSR CUT",43.0,"#534AB7"],[26,"155001 DÖKÜM ŞANZIMAN KAPAĞI P54EVO","155001 CASTING GEARBOX COVER P54EVO",43.0,"#639922"],[27,"121247-F BÜKME AYNASI P44EVO - TP42/45A","121247-F BENDING PLATE P44EVO - TP42/45A",41.5,"#BA7517"],[28,"186050 720X830X12MM CAL35 ST37 LZR KSM","186050 720X830X12MM CAL35 ST37 LSR CUT",40.0,"#E24B4A"],[29,"144004 ŞANZIMAN KAPAĞI P44","144004 GEARBOX COVER P44",40.0,"#185FA5"],[30,"116251-O 725X585X12MM ST16EVO ST37 PLAKA LZR KSM","116251-O 725X585X12MM ST16EVO ST37 PLATE LSR CUT.",33.0,"#0F6E56"],[31,"144002 ŞANZIMAN KAPAĞI P44","144002 GEARBOX COVER P44",32.0,"#993C1D"],[32,"133503 DÖKÜM ŞANZIMAN KAPAĞI P38","133503 CASTING GEARBOX COVER P38",30.3,"#993556"],[33,"121299-F BÜKME AYNASI P38EVO - TP32/36A","121299-F BENDING PLATE P38EVO - TP32/36A",27.0,"#5F5E5A"],[34,"133003 DÖKÜM ŞANZIMAN KAPAĞI P34","133003 CASTING GEARBOX COVER P34",27.0,"#854F0B"],[35,"240155 GÖVDE 15 MM ST37 LZR KSM","240155 BODY 15 MM ST37 LSR CUT",22.0,"#3C3489"],[36,"52010 BAĞLANTI KOLU KOMPLE C54","52010 CONNECTING ROD COMPLETE C54",20.0,"#A32D2D"],[37,"133001 DÖKÜM ŞANZIMAN KAPAĞI P34-P38","133001 CASTING GEARBOX COVER P34-P38",18.0,"#3B6D11"],[38,"240000 SPİRAL TAKIM DİŞLİSİ","240000 GEAR FOR SPRIRAL DEVICE",11.0,"#72243E"],[39,"240030 SPIRAL BÜKME APARATI","240030 SPIRAL BENDING TOOL",4.5,"#27500A"],[40,"240141 KAPAK 12 MM ST37 LZR KSM","240141 COVER 12 MM ST37 LSR CUT",4.0,"#085041"],[41,"240095 SAC 15MM ST37 LZR KSM","240095 SHEET 15MM ST37 LSR CUT",3.0,"#3B8BD4"],[42,"D20,5 - D25,5 DÖKÜM TEKER","D20,5-D25,5 CASTING WHEEL",2.9,"#1D9E75"],[43,"52008 KOL BURCU C54","52008 CONNECTING ROD BUSH C54",2.7,"#D85A30"],[44,"52101 BAĞLANTI SACI","52101 CONNECTION SHEET",2.7,"#D4537E"],[45,"210173 248X78X15MM P44AEVO ST37 LZR KSM","210173 248X78X15MM P44A EVO ST37 LSR CUTTING",2.0,"#534AB7"],[46,"52052 MUHAFAZA KOMPLE C54","52052 COVER COMPLETE C54",2.0,"#639922"],[47,"42101 BAĞLANTI SACI","42101 CONNECTION SHEET",2.0,"#BA7517"],[48,"210187 245X68X15MM P38AEVO ST37 LZR KSM","210187 245X68X15MM P38A EVO ST37 LSR CUT",1.75,"#E24B4A"],[49,"36101 BAĞLANTI SACI C38","36101 CONNECTION PLATE C38",1.6,"#185FA5"],[50,"116925-04 SAC 1,50MM ST37 LZR KSM","116925-04 SHEET 1,50MM ST37 LSR CUT",1.3,"#0F6E56"],[51,"116925-01 SAC 1,50MM ST37 LZR KSM","116925-01 SHEET 1,50MM ST37 LSR CUT",1.25,"#993C1D"],[52,"116921-06 SAC 1,20MM GLV LZR KSM","116921-06 SHEET 1,20MM GLV LSR CUT",1.0,"#993556"],[53,"119054 BAĞLANTI SACI P38EVO","119054 CONNECTION SHEET P38EVO",0.9,"#5F5E5A"],[54,"210171 98,50X78X15MM P44AEVO ST37 LZR KSM","210171 98,50X78X15MM P44A EVO ST37 LSR CUTTING",0.8,"#854F0B"],[55,"119084 210X5MM ST37 LZR KSM P54EVO","119084 210X5MM ST37 LSR CUT P54EVO",0.8,"#3C3489"],[56,"210186 110X68X15MM P38AEVO ST37 LZR KSM","210186 110X68X15MM P38A EVO ST37 LSR CUT",0.75,"#A32D2D"],[57,"119061 BAĞLANTI SACI P44EVO","119061 CONNECTION SHEET P44EVO",0.7,"#3B6D11"],[58,"52016 KAPLİN DİLİ C54","52016 COUPLING NIB C54",0.5,"#72243E"],[59,"800056 100X137X5MM ST37 LZR KSM","800056 100X137X5MM ST37 LSR CUT",0.5,"#27500A"],[60,"52105 CE KAPLİN KİLİTLEME","52105 CE COUPLING LOCK",0.4,"#085041"],[61,"121293 SWİTCH SACI P44EVO","121293 SWITCH SHEET P44EVO",0.4,"#3B8BD4"],[62,"121291 198,18X10MM ST37 LZR KSM P54EVO","121291 198,18X10MM ST37 LSR CUT P54EVO",0.4,"#1D9E75"],[63,"121282 SWİTCH SACI P38EVO","121282 SWITCH SHEET P38EVO",0.4,"#D85A30"],[64,"240153 90X50X10MM ST37 LZR KSM","240153 90X50X10MM ST37 LSR CUT",0.4,"#D4537E"],[65,"42112 YAY ÜST BASKI","42112 SPRING TOP PUSH",0.35,"#534AB7"],[66,"42105 KAPLİN KİLİTLEME SACI","42105 COUPLING LOCK SHEET",0.3,"#639922"],[67,"42016 KAPLİN DİLİ C44","42016 COUPLING NIB C44",0.3,"#BA7517"],[68,"121283 SWİTCH SACI P34EVO","121283 SWITCH SHEET P34EVO",0.3,"#E24B4A"],[69,"36105 KAPLİN İTME SACI","36105 COUPLING PUSH SHEET",0.2,"#185FA5"],[70,"121287-A SWITCH SACI TP32/36-TP42/45","121287-A SWITCH SHEET TP32/36-TP42/45",0.2,"#0F6E56"],[71,"144007 Q105/Q77,5X 5MM ST37 LZR KSM","144007 Q105/Q77,50X 5MM ST37 LSR CUT",0.2,"#993C1D"],[72,"52089 CE MUHAFAZA SACI C54","52089 CE CASING SHEET C54",0.2,"#993556"],[73,"223520 65X40X10MM P56BEVO ST37 LZR KSM","223520 65X40X10MM P56B EVO ST37 LSR CUTTING",0.17,"#5F5E5A"],[74,"22X14X60 AB KESİK KAMA","22X14X60 AB CUT KEY",0.15,"#854F0B"],[75,"121286-A SWİTCH SACI TP25/32","121286-A SWITCH SHEET TP25/32",0.15,"#3C3489"],[76,"36016 KAPLİN DİLİ C38","36016 COUPLING NIB C38",0.15,"#A32D2D"],[77,"52090 PEDAL KİLİTLEME","52090 PEDAL LOCK",0.1,"#3B6D11"],[78,"20X12X55 AB KESİK KAMA","20X12X55 AB CUT KEY",0.1,"#72243E"],[79,"52017 KAPLİN DİL SACI C54","52017 COUPLING NIB GUIDE PLATE C54",0.1,"#27500A"],[80,"42017 KAPLİN DİL SACI C44","42017 COUPLING NIB GUIDE PLATE C44",0.1,"#085041"],[81,"121279 SWİTCH SACI TP","121279 SWITCH SHEET TP",0.1,"#3B8BD4"],[82,"144010 Q75/Q53,5X 5MM ST37 LZR KSM","144010 Q75/Q53,50X 5MM ST37 LSR CUT",0.1,"#1D9E75"],[83,"121294 SWİTCH SACI 4MM","121294 SWITCH SHEET 4MM",0.1,"#D85A30"],[84,"42089 CE MUHAFAZA SACI C44","42089 CE CASING SHEET C44",0.1,"#D4537E"],[85,"36089 CE MUHAFAZA SACI C38","36089 CE CASING SHEET C38",0.1,"#534AB7"],[86,"119034-5 40X60X5 MM ST37 LZR KSM","119034-5 40X60X5 MM ST37 LSR CUT",0.09,"#639922"],[87,"18X11X50 AB KESİK KAMA","18X11X50 AB CUT KEY",0.08,"#BA7517"],[88,"16X10X60 A FORM KAMA","16X10X60 A FORM KEY",0.08,"#E24B4A"],[89,"16X10X50 A FORM KAMA","16X10X50 A FORM KEY",0.07,"#185FA5"],[90,"18X11X45 AB KESİK KAMA","18X11X45 AB CUT KEY",0.07,"#0F6E56"],[91,"52049 M8*65 13 ALTI KÖŞE C38-C44-C54-C74","52049 M8*65 13 HEXAGONAL C38-C44-C54-C74",0.06,"#993C1D"],[92,"116921-20 SAC 1,20MM GLV LZR KSM","116921-20 SHEET 1,20MM GLV LSR CUT",0.05,"#993556"],[93,"36017 KAPLİN DİL SACI C38","36017 COUPLING NIB GUIDE PLATE C38",0.05,"#5F5E5A"],[94,"16X10X40 A FORM KAMA","16X10X40 A FORM KEY",0.05,"#854F0B"],[95,"119034-3 40X60X3 MM ST37 LZR KSM","119034-3 40X60X3 MM ST37 LSR CUTTING",0.05,"#3C3489"],[96,"14X9X36 A FORM KAMA","14X9X36 A FORM KEY",0.04,"#A32D2D"],[97,"10X8X40 A FORM KAMA","10X8X40 A FORM KEY",0.03,"#3B6D11"],[98,"119034-2 40X60X2 MM ST37 LZR KSM","119034-2 40X60X2 MM ST37 LSR CUT",0.03,"#72243E"],[99,"424242 KAPLİN YAY Q12-L53 1,80MM","424242 COUPLING SPRING Q12-L53 1,80MM",0.02,"#27500A"],[100,"8X7X32 A FORM KAMA","8X7X32 A FORM KEY",0.02,"#085041"],[101,"42122 KOL BAĞLANTI SACI","42122 LEVER CONNECTION SHEET",0.02,"#3B8BD4"],[102,"C44 MAKİNE KIRILAN YERİNE GÖNDERİLEN","C44 KIRILAN YERİNE",356.0,"#1D9E75"],[103,"REDÜKTÖR DİŞLİ TAKIMLARI P74 (AYNASIZ)","S. OF P. OF RED. GEAR P74 (WITHOUT PLATE)",300.0,"#D85A30"],[104,"1575-02C GGG50 GÖVDE DÖKÜMÜ P74","1575-02C P74 CASTING GEARBOX",198.0,"#D4537E"],[105,"121412-F BÜKME AYNASI P74","121412-F BENDING PLATE P74",180.0,"#534AB7"],[106,"116550-74 1700X1130X25MM P70 ST37 LZR KSM","116550-74 1700X1130X25MM P70 ST37 LSR CUT",173.0,"#639922"],[107,"1575-01C GGG50 GÖVDE DÖKÜMÜ P74","1575-01C P74 CASTING GEARBOX",141.0,"#BA7517"],[108,"MEKANİK KESME MODÜLÜ PARÇALARI","CUTTING MODULE PARTS PROTOTYPE",130.0,"#E24B4A"],[109,"PLAKA LZR KSM 15MM","PLATE LSR CUT 15MM",92.0,"#185FA5"],[110,"MEKANİK ÇEKME MODÜLÜ PARÇALARI","MECHANIC PULLING MODULE PARTS PROTOTYPE",90.0,"#0F6E56"],[111,"MEKANİK DOĞRULTMA MODÜLÜ PARÇALARI","MECHANIC STRAIGHTENING MODULE PARTS PROTOTYPE",70.0,"#993C1D"],[112,"186001 GGG50 GÖVDE DÖKÜMÜ CAL35","186001 GGG50 BODY CASTING CAL35",65.0,"#993556"],[113,"121259-F BÜKME AYNASI P38","121259-F BENDING PLATE P38",27.0,"#5F5E5A"],[114,"320631-G DAYAMA GÖNYESİ P74","320631-G CHECKING BLOCK P74",25.0,"#854F0B"],[115,"186002 GGG50 GÖVDE DÖKÜMÜ CAL35","186002 GGG50 BODY CASTING CAL35",21.0,"#3C3489"],[116,"400120 BAĞLANTI KOLU KOMPLE TP42/45","400120 CONNECTING ROD COMPLETE TP42/45",16.0,"#A32D2D"],[117,"52011 EKSANTRİK MİL C54","52011 ECCENTRIC SHAFT C54",16.0,"#3B6D11"],[118,"186009 R27,5 DİŞLİ CAL35","186009 R27,5 GEAR CAL35",11.5,"#72243E"],[119,"42015 KOMPLE KAPLİN C44","42015 COMPLETE COUPLING NIB SUPPORT C44",11.0,"#27500A"],[120,"186006 ORTA DİŞLİ CAL35","186006 INTERMEDIUM GEAR CAL35",9.5,"#085041"],[121,"360030 ANA MİL TP32/36","360030 CENTRAL SHAFT TP32/36",7.5,"#3B8BD4"],[122,"186032 GG25 GÖVDE DÖKÜMÜ CAL35","186032 GG25 BODY CASTING CAL35",7.0,"#1D9E75"],[123,"52013 PİNYON DİŞLİ C54","52013 PINION GEAR C54",6.5,"#D85A30"],[124,"250030 ANA MİL TP25/32","250030 CENTRAL SHAFT TP25/32",6.0,"#D4537E"],[125,"186005 ANA MİL CAL35","186005 CENTRAL CHAFT CAL35",4.0,"#534AB7"],[126,"119338-C42 109X94X70MM ST37 OKS.KESİM","119338-C42 109X94X70MM ST37 OXY.CUTTING",4.0,"#639922"],[127,"186007 MİL DİŞLİ CAL35","186007 PINION GEAR CAL35",2.7,"#BA7517"],[128,"250150 EKSANTRİK MİL TP25/32","250150 ECCENTRIC SHAFT TP25/32",1.9,"#E24B4A"],[129,"42052 MUHAFAZA KOMPLE C44","42052 COMPLETE COVER C44",1.4,"#185FA5"],[130,"214620-C42 Q40X135MM C45 MİL","214620-C42 Q40X135MM C45 SHAFT",1.4,"#0F6E56"],[131,"116925-03 SAC 1,50MM ST37 LZR KSM","116925-03 PLATE 1,50MM ST37 LSR CUT",1.4,"#993C1D"],[132,"116921-07 SAC 1,20MM GLV LZR KSM","116921-07 SHEET 1,20MM GLV LSR CUT",1.25,"#993556"],[133,"42086 CE SAC BAĞLANTI KOL KOMPLE","42086 CE SHEET CONNECTION LEVER COMPL.",1.2,"#5F5E5A"],[134,"116925-05 SAC 1,50MM ST37 LZR KSM","116925-05 SHEET 1,50MM ST37 LSR CUT",1.1,"#854F0B"],[135,"116921-09 SAC 1,20MM GLV LZR KSM","116921-09 SHEET 1,20MM GLV LSR CUT",1.0,"#3C3489"],[136,"186051 Q79,5XQ45X55MM-M24 RG5 BRONZ","186051 Q79,5XQ45X55MM-M24 RG5 BRONZ",1.0,"#A32D2D"],[137,"52035 KOMPLE DİL BASKI LAMASI C54","52035 COMPLETE NIB PRESS BAR C54",0.9,"#3B6D11"],[138,"6212 2RS RULMAN","6212 2RS BEARING",0.8,"#72243E"],[139,"250200 Q80-Q60-37 RING TP25/32","250200 Q80-Q60-37 RING TP25/32",0.6,"#27500A"],[140,"129180 KAPLİN KİLİTLEME DİLİ C52","129180 COUPLING NIB C52",0.45,"#085041"],[141,"52112 YAY İTME PARÇASI","52112 SPRING PUSHING PART",0.4,"#3B8BD4"],[142,"129170 KİLİTLEME KAMASI C42","129170 COUPLING NIB  C42",0.4,"#1D9E75"],[143,"52007 YARIM YATAK BRONZU C54","52007 HALF SUPPORT BRONZ C54",0.3,"#D85A30"],[144,"LZR KSM 121287-A SWITCH SACI TP32/36-TP42/45","LSR CUT 121287-A SWITCH SHEET TP32/36-45/45",0.2,"#D4537E"],[145,"42007 YARIM YATAK BRONZU C44","42007 HALF SUPPORT BRONZ C44",0.15,"#534AB7"],[146,"LZR KSM 121286-A SWİTCH SACI TP25/32","LSR CUT 121286-A SWITCH SHEET TP25/32",0.15,"#639922"],[147,"186008 Q85/Q55,5X2,5MM CAL35","186008 Q85/Q55,5X2,5MM CAL35",0.1,"#BA7517"],[148,"36098 SW17 UZATMA","36098 SW17 EXTEND",0.1,"#E24B4A"],[149,"ORİNG TP25/32-TP32/36-TP42-45","ORING TP25/32-TP32/36-TP42/45",0.1,"#185FA5"],[150,"PLAKA LZR KSM 6MM CRNI","PLATE LSR CUT 6MM CRNI",0.1,"#0F6E56"],[151,"75*100*10 KEÇE","75*100*10 OILSEAL",0.1,"#993C1D"],[152,"900004 SAC PLAKA 5MM ST37 LZR KSM","900004 SHEET 5MM ST37 LSR CUT",0.05,"#993556"],[153,"52122 CE KOL BAĞLANTI","52122 CE LEVER CONNECTION",0.03,"#5F5E5A"],[154,"42112 YAY ÜST BASKI CE","42112 SPRING TOP PUSH CE",0.02,"#854F0B"],[155,"119358 3MM ST37 LZR KSM","119358 3MM ST37 LSR CUT",0.02,"#3C3489"],[156,"900004 SAC 5MM ST37 LZR KSM","900004 SHEET 5MM ST37 LSR CUT",0.01,"#A32D2D"],[157,"52050 D18 MUHAFAZA MİLİ C44-C54","52050 D18 COVER SHAFT C44-C54",0.5,"#3B6D11"],[158,"52014 HELİS ORTA DİŞLİ C54","52014 HELIX INTERMEDIUM GEAR C54",17.0,"#72243E"],[159,"42014 HELİS ORTA DİŞLİ C44","42014 HELIX INTERMEDIUM GEAR C44",10.4,"#27500A"],[160,"52012 ORTA MİL DİŞLİ C54","52012 INTERMEDIUM PINION GEAR C54",7.6,"#085041"],[161,"52013 MİL DİŞLİ C54","52013 PINION GEAR C54",6.5,"#3B8BD4"],[162,"42013 PİNYON DİŞLİ C44","42013 PINION GEAR C44",4.2,"#1D9E75"],[163,"195155 DAYAMA GÖNYESİ ST16","195155 CHECKING BLOCK ST16",4.0,"#D85A30"],[164,"36014 HELİS ORTA DİŞLİ C38","36014 HELIX INTERMEDIUM GEAR C38",3.5,"#D4537E"],[165,"36012 ORTA MİL DİŞLİ C38","36012 INTERMEDIUM PINION GEAR C38",2.3,"#534AB7"],[166,"36013 PİNYON DİŞLİ C38","36013 PINION GEAR C38",1.8,"#639922"],[167,"36026 ARKA KAPAK YATAĞI C38","36026 REAR COVER SUPPORT C38",1.6,"#BA7517"],[168,"42008 KOL BURCU C44","42008 CONNECTING ROD BUSH C44",1.5,"#E24B4A"],[169,"36020 ÖN KAPAK YATAĞI C38","36020 FRON COVER SUPPORT C38",1.3,"#185FA5"],[170,"52046 STANDART MUHAFAZA SACI C54","52046 STANDARD COVER SHEET C54",0.4,"#0F6E56"],[171,"194610 D18 MOTOR MİLİ","194610 D18 MOTOR SHAFT",0.4,"#993C1D"],[172,"42105 KAPLİN KİLİTLEME SAC PLAKA","42105 COUPLING LOCK SHEET PLATE",0.3,"#993556"],[173,"ÇEKO (BOSTİK) 888 SİYAH SİLİKON 280 ML.","ÇEKO (BOSTİK) 888 BLACK SEALANT 280ML.",0.3,"#5F5E5A"],[174,"109202 KOL TOPUZU C38-C44-C54-C74","109202 LEVER HOLD C38-C44-C54-C74",0.3,"#854F0B"],[175,"72089 CE MUHAFAZA SACI","72089 CE COVER",0.25,"#3C3489"],[176,"121287-A SWITCH SACI TP32/36-TP42/45 (10MM)","121287-A SWITCH SHEET TP32/36-TP42/45 (10MM)",0.15,"#A32D2D"],[177,"22*14*60 KESİK KAMA","22*14*60 CUT KEY",0.15,"#3B6D11"],[178,"42089 CE MUHAFAZA","42089 CE COVER",0.1,"#72243E"],[179,"36007 YARIM YATAK BRONZU C38","36007 HALF SUPPORT BRONZ C38",0.1,"#27500A"],[180,"52121 15*3 SAC","52121 15*3 SHEET",0.01,"#085041"]],"y":{"2024":[[["c24-1","2024-01-12",true],["c24-2","2024-01-25",true],["c24-3","2024-02-06",true],["c24-4","2024-02-16",true],["c24-5","2024-02-28",true],["c24-6","2024-03-08",true],["c24-7","2024-03-19",true],["c24-8","2024-03-29",true],["c24-9","2024-04-05",true],["c24-10","2024-04-26",true],["c24-11","2024-05-07",true],["c24-12","2024-05-17",true],["c24-13","2024-05-28",true],["c24-14","2024-06-07",true],["c24-15","2024-06-13",true],["c24-16","2024-06-28",true],["c24-17","2024-07-09",true],["c24-18","2024-07-16",true],["c24-19","2024-07-18",true],["c24-20","2024-08-20",true],["c24-21","2024-08-22",true],["c24-22","2024-09-12",true],["c24-23","2024-09-24",true],["c24-24","2024-10-08",true],["c24-25","2024-10-18",true],["c24-26","2024-10-30",true],["c24-27","2024-11-12",true],["c24-28","2024-11-28",true],["c24-29","2024-12-24",true]],{"1":452,"2":395,"3":330,"4":76,"5":97,"6":356,"7":186,"8":120,"9":268,"10":310,"11":436,"12":128,"13":123,"14":186,"15":128,"16":122,"17":186,"18":30,"19":30,"20":21,"21":80,"22":460,"23":99,"24":392,"25":274,"26":99,"27":275,"28":30,"29":150,"30":41,"31":150,"32":11,"33":307,"34":70,"35":30,"36":10,"37":81,"38":30,"39":72,"40":30,"41":30,"42":5400,"43":5,"44":82,"45":431,"46":10,"47":102,"48":274,"49":254,"50":100,"51":895,"52":1019,"53":20,"54":392,"55":80,"56":274,"57":30,"58":110,"59":10,"60":50,"61":80,"62":100,"63":50,"64":35,"65":310,"66":100,"67":50,"68":20,"69":200,"70":600,"71":70,"72":50,"73":84,"74":500,"75":1000,"76":50,"77":350,"78":1100,"79":300,"80":200,"81":100,"82":70,"83":50,"84":50,"85":100,"86":57,"87":1000,"88":50,"89":50,"90":1000,"91":50,"92":100,"93":200,"94":100,"95":58,"96":50,"97":100,"98":58,"99":1000,"100":480,"101":313},{},{"c24-1":{"1":6,"2":12,"3":16,"7":20,"9":30,"14":20,"17":20,"22":22,"23":59,"25":20,"26":59,"48":20,"56":20},"c24-2":{"1":10,"2":10,"3":8,"5":18,"7":14,"12":18,"14":14,"15":18,"17":14,"23":40,"25":20,"26":40,"34":66,"37":66,"42":500,"48":20,"56":20},"c24-3":{"1":12,"2":12,"3":20,"6":20,"10":51,"11":20,"22":40,"29":20,"31":25,"32":11,"34":4,"37":15},"c24-4":{"1":6,"2":10,"3":16,"7":57,"8":52,"9":59,"12":52,"14":57,"15":52,"17":57,"29":60,"31":60,"33":60,"42":1200},"c24-5":{"1":14,"2":10,"3":20,"6":30,"11":30,"22":24,"25":20,"29":50,"31":50,"48":20,"56":20},"c24-6":{"1":14,"2":14,"3":12,"4":18,"10":51,"25":30,"27":32,"29":20,"31":15,"48":30,"56":30},"c24-7":{"1":14,"2":12,"3":16,"5":9,"9":50,"22":40,"42":900},"c24-8":{"1":16,"2":14,"3":12,"6":18,"10":50,"11":48,"21":30,"33":50},"c24-9":{"1":16,"3":4,"7":24,"14":24,"17":24,"18":30,"20":21,"73":84},"c24-10":{"1":18,"2":18,"3":8,"22":40,"24":15,"25":29,"45":15,"48":29,"54":15,"56":29},"c24-11":{"1":18,"2":18,"3":12,"11":18,"21":18,"22":10,"24":17,"33":40,"45":17,"54":17},"c24-12":{"1":18,"2":20,"3":8,"6":33,"11":33,"13":53,"16":52,"25":12,"27":17,"42":400,"45":39,"48":12,"56":12,"65":310},"c24-13":{"1":18,"2":20,"3":12,"8":20,"9":40,"10":50,"25":23,"42":400,"48":23,"56":23,"59":10,"86":57,"95":58,"98":58,"101":313},"c24-14":{"1":18,"2":18,"3":12,"6":15,"11":15,"24":15,"27":30,"30":41,"45":15,"54":15},"c24-15":{"1":18,"2":18,"3":12,"22":50,"33":50},"c24-16":{"1":18,"2":18,"3":8,"6":15,"7":22,"8":44,"11":15,"14":22,"17":22,"22":2,"24":15,"42":400,"45":15,"51":297,"52":306,"54":15},"c24-17":{"1":18,"2":18,"3":8,"9":40,"11":16,"21":16,"25":35,"35":30,"38":30,"39":72,"40":30,"48":35,"56":35,"64":35},"c24-18":{"1":20,"2":18,"3":4,"22":40,"27":30,"41":30,"42":400},"c24-19":{"1":18,"2":16,"3":8,"6":30,"11":30,"22":20,"24":27,"27":30,"45":27,"54":27,"72":50,"84":50,"85":100},"c24-20":{"1":14,"2":20,"3":4,"7":40,"14":40,"17":40,"22":40,"24":53,"44":82,"45":53,"47":102,"49":254,"54":53},"c24-21":{"1":16,"2":16,"3":8,"6":44,"11":44,"25":35,"27":61,"48":35,"56":35},"c24-22":{"1":16,"2":20,"3":8,"10":60,"22":20,"24":50,"45":50,"46":10,"50":100,"51":299,"52":411,"54":50,"58":60,"79":200},"c24-23":{"1":18,"2":14,"3":8,"6":50,"11":50,"27":50,"42":400,"53":20,"55":80,"57":30,"68":20,"71":70,"78":100,"81":100,"82":70,"83":50},"c24-24":{"1":12,"2":8,"3":8,"4":6,"5":18,"12":6,"13":18,"15":6,"16":18,"19":30,"22":20,"24":25,"25":25,"45":25,"48":25,"54":25,"56":25,"61":80,"62":100,"63":50,"70":100},"c24-25":{"1":10,"2":12,"3":20,"4":12,"12":12,"15":12,"22":45,"24":25,"25":25,"27":25,"45":25,"48":25,"54":25,"56":25},"c24-26":{"1":10,"2":16,"3":12,"6":50,"11":66,"21":16,"24":50,"28":30,"36":10,"43":5,"45":50,"54":50,"58":50,"67":50,"70":500,"74":500,"75":1000,"76":50,"78":1000,"79":100,"80":200,"87":1000,"88":50,"89":50,"90":1000,"91":50,"93":200,"94":100,"96":50,"97":100,"99":1000,"100":480},"c24-27":{"1":10,"2":10,"3":12,"4":6,"5":18,"9":45,"12":6,"13":18,"15":6,"16":18,"22":47,"33":50,"42":400,"51":299,"52":302,"92":100},"c24-28":{"1":16,"2":2,"3":16,"4":12,"5":9,"6":50,"11":50,"12":12,"13":9,"15":12,"16":9,"33":57,"42":400,"60":50,"66":100,"69":200,"77":350},"c24-29":{"1":32,"24":100,"45":100,"54":100}}],"2025":[[["c25-1","2024-12-26",true],["c25-2","2024-12-30",true],["c25-3","2025-01-16",true],["c25-4","2025-01-24",true],["c25-5","2025-02-06",true],["c25-6","2025-02-18",true],["c25-7","2025-02-27",true],["c25-8","2025-03-11",true],["c25-9","2025-03-19",true],["c25-10","2025-03-28",true],["c25-11","2025-04-11",true],["c25-12","2025-04-24",true],["c25-13","2025-04-30",true],["c25-14","2025-05-14",true],["c25-15","2025-05-22",true],["c25-16","2025-06-03",true],["c25-17","2025-06-19",true],["c25-18","2025-06-30",true],["c25-19","2025-07-11",true],["c25-20","2025-07-18",true],["c25-21","2025-07-25",true],["c25-22","2025-08-26",true],["c25-23","2025-09-02",true],["c25-24","2025-09-11",true],["c25-25","2025-09-23",true],["c25-26","2025-10-09",true],["c25-27","2025-10-17",true],["c25-28","2025-11-06",true],["c25-29","2025-11-18",true],["c25-30","2025-12-02",true]],{"1":458,"3":224,"4":156,"5":126,"24":206,"8":126,"10":210,"42":6600,"45":206,"12":156,"13":126,"16":126,"15":156,"54":206,"2":444,"102":1,"18":21,"103":6,"104":12,"105":7,"106":2,"107":12,"108":3,"109":3,"110":3,"21":84,"111":4,"22":530,"112":30,"6":340,"25":447,"27":357,"28":30,"30":50,"33":268,"113":6,"7":224,"114":10,"115":30,"36":10,"9":224,"116":2,"117":13,"118":60,"119":4,"120":60,"121":1,"122":30,"123":3,"124":1,"125":60,"126":15,"127":30,"11":424,"47":100,"46":20,"128":1,"48":447,"49":200,"129":15,"130":15,"131":100,"51":2120,"50":100,"132":110,"133":10,"14":224,"134":50,"52":2153,"135":60,"136":44,"137":100,"138":2,"56":447,"139":1,"58":50,"140":51,"141":100,"142":53,"17":224,"67":50,"143":70,"66":99,"65":200,"144":800,"145":40,"146":505,"79":204,"147":60,"148":314,"149":1,"150":11,"151":2,"152":700,"153":200,"154":400,"155":1000,"156":500},{"1":8,"3":18,"4":22,"5":25,"8":4,"10":48,"12":22,"13":25,"16":25,"15":22,"2":1,"6":1,"7":9,"9":4,"11":1,"14":9,"17":9},{"c25-1":{"1":10,"3":16,"4":6,"5":9,"42":400,"12":6,"13":9,"16":9,"15":6,"2":16,"25":54,"33":40,"7":40,"48":54,"14":40,"56":54,"17":40},"c25-2":{"1":20,"3":8,"2":16,"22":57,"9":50},"c25-3":{"1":18,"3":20,"42":400,"2":14,"25":39,"7":28,"48":39,"14":28,"137":100,"56":39,"17":28,"156":500},"c25-4":{"1":14,"3":12,"8":40,"10":56,"2":16,"21":18,"22":36,"6":30,"11":48},"c25-5":{"1":12,"3":16,"4":12,"24":45,"42":400,"45":45,"12":12,"15":12,"54":45,"2":18,"7":21,"46":20,"14":21,"17":21},"c25-6":{"1":14,"3":8,"5":9,"13":9,"16":9,"2":12,"6":50,"25":50,"30":50,"11":50,"48":50,"51":300,"52":300,"56":50},"c25-7":{"1":16,"3":8,"4":12,"8":40,"12":12,"15":12,"2":12,"22":49,"27":32},"c25-8":{"1":8,"3":8,"24":50,"42":400,"45":50,"54":50,"2":4,"103":6,"104":12,"105":7,"106":2,"107":12,"108":3,"109":3,"110":3,"111":4,"33":40,"7":46,"114":10,"121":1,"126":15,"130":15,"51":300,"132":10,"14":46,"134":5,"52":300,"135":10,"17":46,"150":11},"c25-9":{"1":20,"3":8,"42":400,"2":16,"6":40,"9":40,"11":40},"c25-10":{"1":12,"3":8,"4":12,"42":800,"12":12,"15":12,"2":14,"22":30,"25":51,"124":1,"128":1,"48":51,"129":15,"131":100,"51":100,"50":100,"132":100,"134":45,"52":200,"135":50,"138":2,"56":51,"139":1,"149":1,"151":2},"c25-11":{"1":18,"3":12,"5":9,"24":33,"42":450,"45":33,"13":9,"16":9,"54":33,"2":8,"22":27,"7":51,"14":51,"17":51},"c25-12":{"1":12,"3":4,"4":18,"12":18,"15":18,"2":12,"22":50,"6":50,"27":30,"11":50},"c25-13":{"1":18,"3":8,"5":18,"42":400,"13":18,"16":18,"2":16,"25":30,"48":30,"56":30},"c25-14":{"1":16,"3":4,"4":18,"8":49,"42":400,"12":18,"15":18,"2":16,"27":10,"33":35,"136":44},"c25-15":{"1":16,"3":8,"5":18,"13":18,"16":18,"2":14,"21":33,"27":31,"11":33,"58":50,"140":51,"142":53,"79":204},"c25-16":{"1":14,"3":16,"4":6,"12":6,"15":6,"2":18,"22":50,"9":50},"c25-17":{"1":16,"3":4,"5":18,"42":400,"13":18,"16":18,"2":12,"6":30,"25":50,"27":20,"11":30,"48":50,"56":50},"c25-18":{"1":18,"3":12,"5":18,"13":18,"16":18,"2":14,"27":30,"7":47,"14":47,"17":47},"c25-19":{"1":14,"3":12,"4":12,"42":400,"12":12,"15":12,"2":15,"102":1,"22":45,"51":254,"52":145,"144":247,"146":331},"c25-20":{"1":10,"3":12,"5":18,"13":18,"16":18,"2":24,"6":32,"33":50,"113":6,"11":32},"c25-21":{"1":12,"3":8,"24":33,"45":33,"54":33,"2":12,"21":33,"22":18,"25":40,"27":30,"11":33,"48":40,"51":738,"52":728,"56":40},"c25-22":{"1":18,"3":4,"10":54,"42":400,"2":16,"22":24,"27":40,"9":40,"117":13,"47":100,"49":200,"141":100,"66":99,"65":200,"144":553,"146":174,"153":200,"154":400,"155":1000},"c25-23":{"1":18,"3":4,"4":12,"12":12,"15":12,"2":18,"6":30,"33":50,"11":30},"c25-24":{"1":14,"5":9,"24":39,"42":400,"45":39,"13":9,"16":9,"54":39,"2":12,"112":30,"25":40,"27":40,"115":30,"122":30,"48":40,"56":40},"c25-25":{"1":14,"3":4,"4":18,"12":18,"15":18,"2":18,"22":54,"27":22,"148":314},"c25-26":{"1":18,"42":400,"2":20,"25":46,"28":30,"118":60,"120":60,"125":60,"127":30,"48":46,"56":46,"147":60},"c25-27":{"1":10,"3":4,"4":18,"10":60,"12":18,"15":18,"2":24,"6":30,"27":45,"36":10,"119":4,"11":30,"133":10,"67":50,"143":70,"145":40},"c25-28":{"1":20,"5":18,"13":18,"16":18,"2":14,"22":60,"123":3},"c25-29":{"1":12,"3":8,"4":12,"42":475,"12":12,"15":12,"2":18,"25":47,"33":53,"9":48,"48":47,"56":47},"c25-30":{"1":6,"4":18,"12":18,"15":18,"2":6,"18":21,"22":30,"6":49,"27":27,"116":2,"11":49,"51":428,"52":480,"152":700}}],"2026":[[["c26-1","2025-12-30",true],["c26-2","2026-01-15",true],["c26-3","2026-01-27",true],["c26-4","2026-02-05",true],["c26-5","2026-02-17",true],["c26-6","2026-03-05",true],["c26-7","2026-03-17",true],["c26-8","2026-03-26",false],["c26-9","2026-03-31",false],["c26-10","2026-04-09",false],["c26-11","2026-04-17",false],["c26-12","2026-04-28",false],["c26-13","2026-05-07",false],["c26-14","2026-05-14",false],["c26-15","2026-05-21",false]],{"1":336,"2":514,"3":332,"4":128,"5":92,"21":117,"22":397,"6":318,"24":465,"25":266,"27":438,"33":196,"7":135,"42":6000,"45":465,"12":128,"11":435,"48":266,"13":92,"14":135,"16":92,"15":128,"54":465,"56":266,"17":135,"8":109,"157":20,"77":400,"30":70,"9":24,"158":4,"117":5,"159":4,"160":2,"161":2,"162":3,"163":35,"164":3,"43":5,"165":2,"166":5,"167":1,"168":3,"169":2,"135":50,"134":50,"55":80,"58":45,"62":100,"170":30,"171":10,"172":144,"173":125,"174":50,"175":20,"143":60,"69":237,"176":60,"177":500,"79":200,"145":40,"178":50,"95":79,"179":60,"180":1000},{"1":28,"3":6,"4":4,"5":7,"24":6,"10":88,"42":75,"45":6,"12":4,"13":7,"16":7,"15":4,"54":6,"8":1},{"c26-1":{"1":2,"2":24,"3":20,"24":50,"27":50,"42":400,"45":50,"54":50,"8":30,"30":70,"158":4,"117":5,"159":4,"160":2,"161":2,"162":3,"164":3,"43":5,"165":2,"166":5,"167":1,"168":3,"169":2,"135":50,"134":50,"58":45,"171":10,"170":30,"143":60,"79":200,"145":40,"179":60},"c26-2":{"1":10,"2":22,"3":16,"6":30,"24":36,"25":32,"27":30,"45":36,"11":30,"48":32,"54":36,"56":32,"170":30,"174":50},"c26-3":{"1":16,"2":16,"3":12,"22":40,"7":40,"42":800,"14":40,"17":40},"c26-4":{"1":12,"2":16,"3":8,"4":18,"21":32,"27":36,"42":75,"12":18,"11":32,"15":18,"9":24,"163":35,"55":80,"62":100,"173":125,"176":60,"177":500,"95":79},"c26-5":{"1":8,"2":14,"3":12,"4":18,"24":40,"25":40,"33":50,"42":400,"45":40,"12":18,"48":40,"15":18,"54":40,"56":40,"8":40,"180":1000},"c26-6":{"1":16,"2":12,"3":12,"5":9,"22":30,"6":32,"25":39,"11":32,"48":39,"13":9,"16":9,"56":39,"175":20,"178":50},"c26-7":{"1":12,"2":22,"3":16,"4":6,"5":15,"42":400,"12":6,"13":15,"16":15,"15":6,"172":144,"69":237},"c26-8":{"1":24,"2":16,"3":12,"42":400,"157":20,"77":400},"c26-9":{"1":6,"2":14,"3":8,"4":18,"21":30,"25":55,"27":40,"7":50,"42":400,"12":18,"11":30,"48":55,"14":50,"15":18,"56":55,"17":50},"c26-10":{"1":12,"2":10,"3":12,"5":18,"22":40,"6":40,"42":400,"11":40,"13":18,"16":18,"8":40},"c26-11":{"1":14,"2":12,"3":8,"4":18,"24":40,"25":45,"33":60,"45":40,"12":18,"48":45,"15":18,"54":40,"56":45},"c26-12":{"1":14,"2":22,"3":12,"24":40,"27":40,"42":400,"45":40,"54":40},"c26-13":{"1":18,"2":24,"3":16,"42":400},"c26-14":{"1":10,"2":20,"3":8,"4":18,"22":40,"6":40,"12":18,"11":40,"15":18},"c26-15":{"1":10,"2":20,"3":4,"5":18,"24":60,"27":60,"42":400,"45":60,"13":18,"16":18,"54":60}}],"2027":[[],{},{},{}]}};

const parseData = (raw) => {
  const products = raw.p.map(p => ({ id: p[0], nameTR: p[1], nameEN: p[2], kg: p[3], color: p[4] }));
  const yearsData = {};
  for (const [year, yd] of Object.entries(raw.y)) {
    const containers = yd[0].map(c => ({ id: c[0], date: c[1], shipped: c[2] }));
    const orders = {};
    for (const [k, v] of Object.entries(yd[1])) orders[Number(k)] = v;
    const carryOver = {};
    for (const [k, v] of Object.entries(yd[2])) carryOver[Number(k)] = v;
    const quantities = {};
    for (const [cid, q] of Object.entries(yd[3])) {
      quantities[cid] = {};
      for (const [pid, qty] of Object.entries(q)) quantities[cid][Number(pid)] = qty;
    }
    yearsData[Number(year)] = { containers, orders, carryOver, quantities };
  }
  return { products, yearsData };
};

const PARSED = parseData(RAW);
const DEFAULT_MIN = 23200, DEFAULT_MAX = 23600;

const YEARLY_SALES = {
  3: {name:"C38ST.",data:{2016:186,2017:20,2018:124,2019:110,2020:167,2021:275,2022:225,2023:280,2024:312,2025:236,2026:96}},
  2: {name:"C44ST.",data:{2016:154,2017:151,2018:168,2019:169,2020:63,2021:226,2022:189,2023:305,2024:394,2025:439,2026:126}},
  1: {name:"C54ST.",data:{2016:180,2017:311,2018:221,2019:189,2020:110,2021:259,2022:381,2023:208,2024:444,2025:432,2026:76}},
  5: {name:"TP25/32",data:{2016:36,2017:0,2018:50,2019:88,2020:39,2021:169,2022:0,2023:131,2024:72,2025:144,2026:24}},
  4: {name:"TP32/36",data:{2016:0,2017:54,2018:48,2019:74,2020:64,2021:103,2022:78,2023:147,2024:54,2025:156,2026:42}},
  18:{name:"TP42/45",data:{2016:0,2017:0,2018:22,2019:0,2020:22,2021:46,2022:0,2023:0,2024:30,2025:0,2026:0}},
};

const INITIAL_RULES = [
  {parent:7, children:[17,14]},   // 116571-O → 210183 + 210184
  {parent:25, children:[56,48]},  // 116602-O → 210186 + 210187
  {parent:5, children:[13,16]},   // TP25/32 → 210181 + 210189
  {parent:4, children:[12,15]},   // TP32/36 → 210185 + 210180
  {parent:6, children:[11]},      // 116521-O → 210174
  {parent:21, children:[11]},     // 116522 → 210174
  {parent:24, children:[45,54]},  // 116660-O → 210173 + 210171
];

const VIO_CODES = {1:"152-0104",2:"152-0108",3:"152-0151",4:"152-0109",5:"152-0154",6:"152-0659",7:"152-0577",8:"152-0656",9:"152-0620",10:"150-0663",11:"152-0665",12:"151-0452",13:"152-0663",14:"152-0583",15:"151-0453",16:"152-0664",17:"152-0584",18:"152-0105",19:"152-0388",20:"152-0670",21:"152-0678",22:"152-0662",23:"150-1298",24:"152-0658",25:"152-0593",26:"150-1297",27:"152-0128",28:"152-0563",29:"152-0635",30:"152-0576",31:"152-0634",32:"150-1291",33:"152-0592",34:"150-1290",35:"152-0495",36:"151-0218",37:"150-1289",38:"152-0144",39:"152-0136",40:"152-0493",41:"152-0617",42:"150-0228",43:"151-0216",44:"151-0260",45:"152-0666",46:"151-0250",47:"151-0146",48:"152-0601",49:"151-0347",50:"152-0681",51:"152-0618",52:"152-0619",53:"151-0526",54:"152-0667",55:"152-1434",56:"152-0600",57:"151-0527",58:"151-0224",59:"152-0585",60:"151-0263",61:"151-0525",62:"152-1433",63:"151-0524",64:"152-1435",65:"151-0152",66:"151-0148",67:"151-0168",68:"151-0523",69:"151-0105",70:"151-0450",71:"152-0668",72:"151-0259",73:"152-0679",74:"150-0481",75:"151-0401",76:"151-0091",77:"151-0314",78:"150-1303",79:"151-0454",80:"151-0169",81:"151-0529",82:"152-0669",83:"151-0528",84:"151-0200",85:"151-0101",86:"152-1438",87:"150-0524",88:"150-1306",89:"150-1305",90:"150-0556",91:"151-0357",92:"152-1439",93:"151-0092",94:"150-1300",95:"152-1436",96:"150-0560",97:"150-1301",98:"152-1437",99:"150-0613",100:"150-1296",101:"151-0155",103:"152-0097",104:"150-0340",105:"150-1294",106:"152-1429",107:"150-0339",108:"152-1440",109:"151-0521",110:"152-1445",111:"152-1446",112:"150-0906",113:"152-0187",114:"150-1295",115:"150-0907",116:"151-0441",117:"151-0219",118:"152-0423",119:"150-0242",120:"152-0417",121:"151-0413",122:"150-0908",123:"151-0221",124:"151-0395",125:"152-0418",126:"152-0630",127:"152-0413",128:"151-0393",129:"151-0193",130:"152-1447",131:"152-0671",132:"152-0672",133:"151-0145",134:"152-0682",135:"152-1425",136:"152-0680",137:"151-0239",138:"150-0504",139:"151-0404",140:"151-0208",141:"151-0329",142:"151-0136",143:"150-0281",144:"151-0450-1",145:"150-0238",146:"151-0401-1",147:"152-1450",148:"151-0131",149:"150-0890",150:"151-0521",151:"150-0473",152:"152-1430",153:"151-0265",154:"151-0152",155:"151-0522",156:"152-1430",157:"151-0248",158:"151-0222",159:"151-0165",160:"151-0220",161:"151-0221",162:"151-0164",163:"152-0102",164:"151-0089",165:"151-0087",166:"151-0088",167:"150-0293",168:"151-0159",169:"150-0291",170:"151-0246",171:"151-0353",172:"151-0148",173:"150-0741",174:"151-0351",175:"151-0321",176:"151-0450",177:"150-0481",178:"151-0200",179:"150-0279",180:"151-0338"};
const VIO_REVERSE = Object.fromEntries(Object.entries(VIO_CODES).map(([pid,code])=>[code,Number(pid)]));

const fmtDate = d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"});
const shortDate = d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit"});

const TODAY = new Date();
TODAY.setHours(0,0,0,0);
const isShipped = (c) => {
  const parts = c.date.split("-");
  const d = new Date(parts[0], parts[1]-1, parts[2]);
  d.setDate(d.getDate() + 1);
  return d <= TODAY;
};

const Badge = ({status}) => {
  const s = {shipped:{bg:"#085041",c:"#9FE1CB",l:"Sevk Edildi"},planned:{bg:"#0C447C",c:"#B5D4F4",l:"Planlandı"}}[status]||{bg:"#633806",c:"#FAC775",l:"Bekliyor"};
  return <span style={{display:"inline-block",padding:"2px 8px",borderRadius:4,fontSize:11,fontWeight:500,background:s.bg,color:s.c,whiteSpace:"nowrap"}}>{s.l}</span>;
};

const KPI = ({label,value,sub,accent}) => (
  <div style={{background:"var(--color-background-secondary)",borderRadius:12,padding:"14px 18px",flex:1,minWidth:150,borderLeft:`3px solid ${accent||"#534AB7"}`}}>
    <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:3}}>{label}</div>
    <div style={{fontSize:20,fontWeight:600,color:"var(--color-text-primary)"}}>{value}</div>
    {sub&&<div style={{fontSize:10,color:"var(--color-text-tertiary)",marginTop:2}}>{sub}</div>}
  </div>
);

const Modal=({title,onClose,children})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}} onClick={onClose}>
    <div style={{background:"var(--color-background-primary)",borderRadius:16,padding:24,minWidth:380,maxWidth:500,maxHeight:"80vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:600}}>{title}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",color:"var(--color-text-secondary)"}}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

export default function App() {
  // Auth states
  const [authUser, setAuthUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showUserMgmt, setShowUserMgmt] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [newUserRole, setNewUserRole] = useState("viewer");
  const [newUserName, setNewUserName] = useState("");

  // App states
  const [page, setPage] = useState("planning");
  const [selYear, setSelYear] = useState(2026);
  const [products, setProducts] = useState(PARSED.products);
  const [yearsData, setYearsData] = useState(PARSED.yearsData);
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [showAddC, setShowAddC] = useState(false);
  const [newCDate, setNewCDate] = useState("");
  const [showAddP, setShowAddP] = useState(false);
  const [newP, setNewP] = useState({nameTR:"",nameEN:"",kg:"",vioCode:"",qtyPerPallet:"",ambalajType:0,dara:""});
  const [showAddO, setShowAddO] = useState(false);
  const [orderPid, setOrderPid] = useState("");
  const [orderQty, setOrderQty] = useState("");
  const [orderYear, setOrderYear] = useState(new Date().getFullYear());
  const [sidebar, setSidebar] = useState(false);
  const [lang, setLang] = useState("TR");
  const [minKG, setMinKG] = useState(DEFAULT_MIN);
  const [maxKG, setMaxKG] = useState(DEFAULT_MAX);
  const [showSettings, setShowSettings] = useState(false);
  const [tmpMin, setTmpMin] = useState(DEFAULT_MIN.toString());
  const [tmpMax, setTmpMax] = useState(DEFAULT_MAX.toString());
  const [search, setSearch] = useState("");
  const [combRules, setCombRules] = useState(INITIAL_RULES);
  const [showCombEdit, setShowCombEdit] = useState(false);
  const [newRuleParent, setNewRuleParent] = useState("");
  const [newRuleChildren, setNewRuleChildren] = useState("");
  const [dashProduct, setDashProduct] = useState("");
  const [linkedExtras, setLinkedExtras] = useState({});
  const [editDateId, setEditDateId] = useState(null);
  const [editDateVal, setEditDateVal] = useState("");
  const [editOrderPid, setEditOrderPid] = useState(null);
  const [editOrderVal, setEditOrderVal] = useState("");
  const [selectedCids, setSelectedCids] = useState(new Set());
  const [exportLang, setExportLang] = useState("EN");
  const [selectedRow, setSelectedRow] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [pdfHtml, setPdfHtml] = useState(null);
  const [hideShipped, setHideShipped] = useState(true);
  const [importData, setImportData] = useState(null);
  const [importYear, setImportYear] = useState(new Date().getFullYear());
  const [importNewProducts, setImportNewProducts] = useState([]);
  // Packing states
  const [packingCid, setPackingCid] = useState(null); // which container is being packed
  const [pallets, setPallets] = useState([]); // array of pallet objects
  const [kantarBrut, setKantarBrut] = useState("");
  const [kantarApplied, setKantarApplied] = useState(false);
  const [packingStandards, setPackingStandards] = useState({}); // {pid: {qtyPerPallet, ambalajType, dara}}
  const [editStdPid, setEditStdPid] = useState(null);
  const [editStdTemp, setEditStdTemp] = useState({qtyPerPallet:"",ambalajType:0,dara:""});
  const inputRef = useRef(null);
  const saveTimer = useRef(null);
  const firestoreReady = useRef(false);

  const isAdmin = userRole === "admin";
  const isPacker = userRole === "packer";
  const isUretim = userRole === "uretim";
  const canPack = isAdmin || isPacker;

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setAuthUser(user);
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          setUserRole(userDoc.data().role);
        } else {
          setUserRole("viewer");
        }
      } else {
        setAuthUser(null);
        setUserRole(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // Listen to Firestore data changes
  useEffect(() => {
    if (!authUser) return;
    const unsub = onSnapshot(doc(db, "appData", "state"), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.yearsData) setYearsData(d.yearsData);
        if (d.products) setProducts(d.products);
        if (d.combRules) setCombRules(d.combRules);
        if (d.packingStandards) setPackingStandards(d.packingStandards);
        if (d.minKG) setMinKG(d.minKG);
        if (d.maxKG) setMaxKG(d.maxKG);
        setDataLoaded(true);
        setTimeout(() => { firestoreReady.current = true; }, 2000);
      }
    });
    return () => unsub();
  }, [authUser]);

  // Save to Firestore (debounced, admin/packer only, only after user edits)
  const saveToFirestore = useCallback((data) => {
    if (!canPack || !firestoreReady.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "appData", "state"), data);
      } catch (e) { console.error("Save error:", e); }
    }, 1500);
  }, [canPack]);

  // Auto-save when data changes (admin/packer only, after Firestore ready)
  useEffect(() => {
    if (!canPack || !dataLoaded || !firestoreReady.current) return;
    saveToFirestore({ yearsData, products, combRules, minKG, maxKG, packingStandards });
  }, [yearsData, products, combRules, minKG, maxKG, packingStandards, canPack, dataLoaded, saveToFirestore]);

  // Initial data upload (first time only)
  const uploadInitialData = async () => {
    const snap = await getDoc(doc(db, "appData", "state"));
    if (!snap.exists()) {
      await setDoc(doc(db, "appData", "state"), {
        yearsData: PARSED.yearsData,
        products: PARSED.products,
        combRules: INITIAL_RULES,
        minKG: DEFAULT_MIN,
        maxKG: DEFAULT_MAX
      });
      setDataLoaded(true);
    }
  };

  const doLogin = async () => {
    setLoginError("");
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPass);
    } catch (e) {
      setLoginError(e.code === "auth/invalid-credential" ? "Hatalı email veya şifre" : 
                    e.code === "auth/too-many-requests" ? "Çok fazla deneme, bekleyin" : "Giriş hatası: " + e.message);
    }
  };

  const doLogout = async () => { await signOut(auth); };

  const loadUsers = async () => {
    try {
      const regDoc = await getDoc(doc(db, "appData", "userRegistry"));
      if (regDoc.exists()) {
        const data = regDoc.data();
        setAllUsers(Object.entries(data).map(([uid, u]) => ({ uid, ...u })));
      }
    } catch (e) { console.error("Load users error:", e); }
  };

  const updateUserRole = async (uid, newRole) => {
    try {
      // Update in users collection (for auth)
      await setDoc(doc(db, "users", uid), { role: newRole }, { merge: true });
      // Update in registry
      const regDoc = await getDoc(doc(db, "appData", "userRegistry"));
      const reg = regDoc.exists() ? regDoc.data() : {};
      reg[uid] = { ...reg[uid], role: newRole };
      await setDoc(doc(db, "appData", "userRegistry"), reg);
      setAllUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } catch (e) { alert("Rol güncelleme hatası: " + e.message); }
  };

  const createUser = async () => {
    if (!newUserEmail || !newUserPass || !newUserName) return;
    try {
      const resp = await createUserWithEmailAndPassword(auth, newUserEmail, newUserPass);
      const uid = resp.user.uid;
      // Save to users collection
      await setDoc(doc(db, "users", uid), {
        email: newUserEmail, role: newUserRole, name: newUserName
      });
      // Save to registry (accessible by admin)
      const regDoc = await getDoc(doc(db, "appData", "userRegistry"));
      const reg = regDoc.exists() ? regDoc.data() : {};
      reg[uid] = { email: newUserEmail, role: newUserRole, name: newUserName };
      await setDoc(doc(db, "appData", "userRegistry"), reg);
      // createUserWithEmailAndPassword signs in as new user, sign back as admin
      await signOut(auth);
      setNewUserEmail("");setNewUserPass("");setNewUserName("");
      alert("Kullanıcı oluşturuldu! Tekrar giriş yapmanız gerekiyor.");
      setShowUserMgmt(false);
    } catch (e) {
      alert("Hata: " + e.message);
    }
  };

  // Register current user in registry on login (all roles)
  useEffect(() => {
    if (!authUser || !userRole) return;
    (async () => {
      try {
        const regDoc = await getDoc(doc(db, "appData", "userRegistry"));
        const reg = regDoc.exists() ? regDoc.data() : {};
        if (!reg[authUser.uid]) {
          const userDoc = await getDoc(doc(db, "users", authUser.uid));
          if (userDoc.exists()) {
            reg[authUser.uid] = userDoc.data();
            await setDoc(doc(db, "appData", "userRegistry"), reg);
          }
        }
      } catch (e) { console.error("Registry migration:", e); }
    })();
  }, [authUser, userRole]);

  const yd = yearsData[selYear] || {containers:[],orders:{},carryOver:{},quantities:{}};
  const visibleContainers = hideShipped ? yd.containers.filter(c=>!isShipped(c)) : yd.containers;

  const getCKG = useCallback(cid => {
    const q = yd.quantities[cid]||{};
    return Object.entries(q).reduce((s,[pid,qty])=>{
      const p = products.find(pr=>pr.id===Number(pid));
      return s+(p?p.kg*(qty||0):0);
    },0);
  },[yd,products]);

  const getStatus = useCallback(kg => {
    if(kg===0) return {s:"empty",c:"var(--color-text-tertiary)",bg:"transparent",l:"BOŞ",i:"○"};
    if(kg>=minKG&&kg<=maxKG) return {s:"ok",c:"#1D9E75",bg:"rgba(8,80,65,0.12)",l:"ONAY",i:"✓"};
    if(kg>maxKG) return {s:"over",c:"#E24B4A",bg:"rgba(226,75,74,0.12)",l:"FAZLA",i:"✕"};
    if(kg>=minKG-500) return {s:"close",c:"#BA7517",bg:"rgba(186,117,23,0.10)",l:"YAKIN",i:"◐"};
    return {s:"low",c:"#E24B4A",bg:"rgba(226,75,74,0.12)",l:"EKSİK",i:"✕"};
  },[minKG,maxKG]);

  const getPStats = useCallback(pid => {
    const order = (yd.orders[pid]||0)+(yd.carryOver[pid]||0);
    let planned=0,shipped=0,pNotShipped=0;
    yd.containers.forEach(c=>{
      const q=(yd.quantities[c.id]||{})[pid]||0;
      planned+=q;
      if(isShipped(c)) shipped+=q; else pNotShipped+=q;
    });
    return {order,planned,shipped,pNotShipped,remaining:order-shipped,toBePlanned:order-planned};
  },[yd]);

  // Carry-over calculation
  const computeCarryOver = useCallback((fromYear) => {
    const fyd = yearsData[fromYear];
    if(!fyd) return {};
    const co = {};
    products.forEach(p => {
      const order = (fyd.orders[p.id]||0)+(fyd.carryOver[p.id]||0);
      let planned = 0;
      fyd.containers.forEach(c => { planned += (fyd.quantities[c.id]||{})[p.id]||0; });
      const remaining = order - planned;
      if(remaining > 0) co[p.id] = remaining;
    });
    return co;
  },[yearsData,products]);

  const doCarryOver = (fromYear, toYear) => {
    const co = computeCarryOver(fromYear);
    if(Object.keys(co).length === 0) return;
    setYearsData(prev => {
      const ty = {...prev[toYear]||{containers:[],orders:{},carryOver:{},quantities:{}}};
      ty.carryOver = {...ty.carryOver};
      for(const [pid,qty] of Object.entries(co)) ty.carryOver[Number(pid)] = qty;
      return {...prev,[toYear]:ty};
    });
  };

  // Combined rules helpers
  const isLinkedChild = useCallback((pid) => {
    return combRules.some(r => r.children.includes(pid));
  },[combRules]);

  const getLinkedParents = useCallback((cid, pid) => {
    // Returns parent product ids that trigger this child in this container
    return combRules.filter(r => r.children.includes(pid)).map(r => r.parent).filter(parentId => {
      const q = (yd.quantities[cid]||{})[parentId]||0;
      return q > 0;
    });
  },[combRules, yd]);

  const getLinkedQty = useCallback((cid, pid) => {
    // Sum of all parent quantities that link to this child
    return combRules.filter(r => r.children.includes(pid)).reduce((sum, r) => {
      return sum + ((yd.quantities[cid]||{})[r.parent]||0);
    }, 0);
  },[combRules, yd]);

  const cellClick = (cid,pid,val) => {
    if(!isAdmin || !allowedYears.includes(selYear)) return;
    setEditCell({cid,pid}); setEditValue(val||""); setTimeout(()=>inputRef.current?.focus(),50);
  };

  // Calculate cascade-only total for a child in a container (sum of all parent quantities)
  const getCascadeQty = useCallback((cid, childId, overrideParent, overrideVal) => {
    return combRules.filter(r => r.children.includes(childId)).reduce((sum, r) => {
      const parentQty = (r.parent === overrideParent) ? overrideVal : ((yd.quantities[cid]||{})[r.parent]||0);
      return sum + parentQty;
    }, 0);
  },[combRules, yd]);

  const getExtra = (cid, pid) => (linkedExtras[cid]||{})[pid]||0;

  const cellSave = () => {
    if(!editCell) return;
    const {cid, pid} = editCell;
    let val=parseInt(editValue)||0;
    const isChild = isLinkedChild(pid);
    const isParent = combRules.some(r => r.parent === pid);

    // Max check: cannot plan more than remaining order
    const stats = getPStats(pid);
    const currentQty = (yd.quantities[cid]||{})[pid]||0;
    const maxAllowed = stats.toBePlanned + currentQty; // what's left + what's already in this cell
    if(val > maxAllowed && maxAllowed >= 0) val = maxAllowed;
    if(val < 0) val = 0;

    if(isChild && !isParent) {
      // Editing a linked child directly → enforce minimum = cascade, difference = manual extra
      const cascade = getCascadeQty(cid, pid, null, 0);
      const finalVal = Math.max(val, cascade); // cannot go below cascade
      const extra = finalVal - cascade;
      setLinkedExtras(prev => {
        const ce = {...(prev[cid]||{})};
        if(extra === 0) delete ce[pid]; else ce[pid] = extra;
        return {...prev, [cid]: ce};
      });
      setYearsData(prev=>{
        const y={...prev[selYear]};const q={...y.quantities};const cq={...(q[cid]||{})};
        cq[pid]=finalVal;
        q[cid]=cq;y.quantities=q;return{...prev,[selYear]:y};
      });
    } else {
      // Editing a parent (or non-linked product) → cascade to children, preserve extras
      setYearsData(prev=>{
        const y={...prev[selYear]};const q={...y.quantities};const cq={...(q[cid]||{})};
        cq[pid]=val;
        // Cascade to children
        combRules.filter(r => r.parent === pid).forEach(rule => {
          rule.children.forEach(childId => {
            const cascadeTotal = getCascadeQty(cid, childId, pid, val);
            const extra = getExtra(cid, childId);
            const childTotal = cascadeTotal + extra;
            cq[childId] = childTotal;
          });
        });
        q[cid]=cq;y.quantities=q;return{...prev,[selYear]:y};
      });
    }
    setEditCell(null);
  };
  const cellKey = e => { if(e.key==="Enter") cellSave(); if(e.key==="Escape") setEditCell(null); };

  const saveDate = (cid) => {
    if(!editDateVal) { setEditDateId(null); return; }
    setYearsData(prev=>{
      const y={...prev[selYear]};
      const cs=y.containers.map(c=>c.id===cid?{...c,date:editDateVal}:c).sort((a,b)=>new Date(a.date)-new Date(b.date));
      return{...prev,[selYear]:{...y,containers:cs}};
    });
    setEditDateId(null);
  };

  const saveOrder = (pid) => {
    if(editOrderPid === null) return;
    let newVal = parseInt(editOrderVal) || 0;
    const stats = getPStats(pid);
    // Cannot go below already planned amount
    const minAllowed = stats.planned;
    if(newVal < minAllowed) newVal = minAllowed;
    if(newVal < 0) newVal = 0;
    
    const oldVal = yd.orders[pid] || 0;
    const diff = newVal - oldVal;
    
    setYearsData(prev => {
      const y = {...prev[selYear]};
      const orders = {...y.orders};
      orders[pid] = newVal;
      // Cascade to linked children
      combRules.filter(r => r.parent === pid).forEach(rule => {
        rule.children.forEach(childId => {
          orders[childId] = Math.max(0, (orders[childId] || 0) + diff);
        });
      });
      return {...prev, [selYear]: {...y, orders}};
    });
    setEditOrderPid(null);
  };

  const handleVioImport = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, {type:"array"});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1});
      // Find header row with CODE/DESCRIPTION/QUANTITY
      let headerIdx = -1;
      for(let i=0;i<Math.min(10,rows.length);i++){
        const r = rows[i]?.map(v=>String(v||"").toUpperCase())||[];
        if(r.some(v=>v.includes("CODE"))&&r.some(v=>v.includes("QUANTITY")||v.includes("QTY"))){headerIdx=i;break;}
      }
      if(headerIdx===-1){alert("Excel'de CODE ve QUANTITY sütunları bulunamadı.");return;}
      const header=rows[headerIdx].map(v=>String(v||"").toUpperCase());
      const codeIdx=header.findIndex(v=>v.includes("CODE"));
      const qtyIdx=header.findIndex(v=>v.includes("QUANTITY")||v.includes("QTY"));
      const descIdx=header.findIndex(v=>v.includes("DESC"));
      
      const matched=[];const unmatched=[];
      for(let i=headerIdx+1;i<rows.length;i++){
        const r=rows[i];if(!r||!r[codeIdx]) continue;
        const code=String(r[codeIdx]).trim();
        const qty=parseInt(r[qtyIdx])||0;
        const desc=descIdx>=0?String(r[descIdx]||""):"";
        if(qty<=0) continue;
        const pid=VIO_REVERSE[code];
        if(pid){
          const p=products.find(pr=>pr.id===pid);
          matched.push({pid,code,qty,name:p?.nameTR||code,nameEN:p?.nameEN||"",kg:p?.kg||0});
        } else {
          unmatched.push({code,qty,desc,nameTR:"",nameEN:desc,kg:"",approved:false});
        }
      }
      setImportData({matched,unmatched});
      setImportNewProducts(unmatched.map(u=>({...u})));
    };
    reader.readAsArrayBuffer(file);
    e.target.value="";
  };

  const executeImport = () => {
    if(!importData||!allowedYears.includes(importYear)) return;
    setYearsData(prev=>{
      const y={...(prev[importYear]||{containers:[],orders:{},carryOver:{},quantities:{}})};
      const orders={...y.orders};
      // Add matched products
      importData.matched.forEach(m=>{
        orders[m.pid]=(orders[m.pid]||0)+m.qty;
        // Cascade
        combRules.filter(r=>r.parent===m.pid).forEach(rule=>{
          rule.children.forEach(childId=>{orders[childId]=(orders[childId]||0)+m.qty;});
        });
      });
      // Add approved new products (already added to products list)
      importNewProducts.filter(np=>np.approved&&np.newPid).forEach(np=>{
        orders[np.newPid]=(orders[np.newPid]||0)+np.qty;
      });
      return{...prev,[importYear]:{...y,orders}};
    });
    alert(`${importData.matched.length} ürün siparişi ${importYear} yılına aktarıldı!`);
    setImportData(null);setImportNewProducts([]);
  };

  const approveNewProduct = (idx) => {
    const np=importNewProducts[idx];
    if(!np.nameTR||!np.nameEN||!np.kg) {alert("TR isim, EN isim ve KG zorunlu!");return;}
    const newId=Math.max(...products.map(p=>p.id))+1;
    const newP={id:newId,nameTR:np.nameTR,nameEN:np.nameEN,kg:parseFloat(np.kg),color:`#${Math.floor(Math.random()*16777215).toString(16).padStart(6,"0")}`};
    setProducts(prev=>[...prev,newP]);
    setImportNewProducts(prev=>prev.map((p,i)=>i===idx?{...p,approved:true,newPid:newId}:p));
  };

  const toggleCid = (cid) => setSelectedCids(prev=>{const s=new Set(prev);if(s.has(cid))s.delete(cid);else s.add(cid);return s;});
  const selectAllUnshipped = () => {const unshipped=yd.containers.filter(c=>!isShipped(c)).map(c=>c.id);setSelectedCids(new Set(unshipped));};

  const buildExportData = () => {
    const cids=[...selectedCids];
    const isEN=exportLang==="EN";
    return cids.map(cid=>{
      const c=yd.containers.find(cc=>cc.id===cid);if(!c) return null;
      const kg=getCKG(cid);const st=getStatus(kg);
      const items=Object.entries(yd.quantities[cid]||{}).filter(([,q])=>q>0).map(([pid,qty])=>{
        const p=products.find(pr=>pr.id===Number(pid));
        return p?{name:isEN?p.nameEN:p.nameTR,qty,kg:p.kg,totalKG:p.kg*qty}:null;
      }).filter(Boolean).sort((a,b)=>b.kg-a.kg);
      return{date:c.date,totalKG:kg,status:st,items};
    }).filter(Boolean);
  };

  const exportPDF = () => {
    const data=buildExportData();if(data.length===0) return;
    const isEN=exportLang==="EN";
    const title=isEN?"SHIPMENT PLAN":"SEVKİYAT PLANI";
    const html=`<div style="font-family:Arial,sans-serif;padding:20px;color:#1a1a1a;font-size:12px">
    <h1 style="font-size:18px;margin:0 0 4px">${title}</h1>
    <div style="color:#666;margin-bottom:20px;font-size:11px">${isEN?"Date":"Tarih"}: ${new Date().toLocaleDateString("tr-TR")} · ${isEN?"Year":"Yıl"}: ${selYear}</div>
    ${data.map(d=>{
      const sc=d.status.s==="ok"?"#e1f5ee":d.status.s==="close"?"#faeeda":"#fcebeb";
      const tc=d.status.s==="ok"?"#0F6E56":d.status.s==="close"?"#854F0B":"#A32D2D";
      return`<div style="border:1px solid #ddd;border-radius:8px;padding:14px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #eee">
          <span style="font-size:15px;font-weight:bold">${fmtDate(d.date)}</span>
          <span style="font-size:11px;padding:3px 10px;border-radius:4px;font-weight:bold;background:${sc};color:${tc}">${d.status.i} ${d.status.l} — ${Math.round(d.totalKG).toLocaleString()} KG</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><th style="text-align:left;padding:5px 8px;border-bottom:2px solid #ddd;font-weight:600;color:#555">${isEN?"Product":"Ürün"}</th><th style="text-align:right;padding:5px 8px;border-bottom:2px solid #ddd;font-weight:600;color:#555">${isEN?"Qty":"Adet"}</th><th style="text-align:right;padding:5px 8px;border-bottom:2px solid #ddd;font-weight:600;color:#555">${isEN?"Unit KG":"Birim KG"}</th><th style="text-align:right;padding:5px 8px;border-bottom:2px solid #ddd;font-weight:600;color:#555">${isEN?"Total KG":"Toplam KG"}</th></tr>
          ${d.items.map(it=>`<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${it.name}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${it.qty}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${it.kg}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${Math.round(it.totalKG).toLocaleString()}</td></tr>`).join("")}
          <tr><td style="padding:5px 8px;font-weight:bold;border-top:2px solid #333">${isEN?"TOTAL":"TOPLAM"}</td><td></td><td></td><td style="text-align:right;padding:5px 8px;font-weight:bold;border-top:2px solid #333">${Math.round(d.totalKG).toLocaleString()} KG</td></tr>
        </table>
      </div>`;
    }).join("")}
    </div>`;
    setPdfHtml(html);
  };

  const printPdf = () => {
    const el=document.getElementById("pdf-preview");
    if(!el) return;
    const isLabel = el.querySelector('[data-label="true"]') !== null;
    const iframe=document.createElement("iframe");
    iframe.style.cssText="position:fixed;top:0;left:0;width:0;height:0;border:none;";
    document.body.appendChild(iframe);
    const doc=iframe.contentDocument;
    doc.open();
    const pageStyle = isLabel 
      ? `@page{size:100mm 200mm;margin:0}*{margin:0;padding:0;box-sizing:border-box}.label-page{width:100mm;height:200mm;page-break-after:always}`
      : `*{margin:0;padding:0;box-sizing:border-box}@media print{div{break-inside:avoid}[style*="page-break-after"]{page-break-after:always}}`;
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>${pageStyle}</style></head><body>${el.innerHTML}</body></html>`);
    doc.close();
    // Wait for all images (including external QR codes) to load before printing
    const imgs = doc.querySelectorAll("img");
    if(imgs.length > 0) {
      let loaded = 0;
      const onReady = () => { loaded++; if(loaded >= imgs.length) { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(()=>document.body.removeChild(iframe),2000); }};
      imgs.forEach(img => { if(img.complete) onReady(); else { img.onload = onReady; img.onerror = onReady; }});
      // Fallback: print after 5 seconds even if images didn't load
      setTimeout(() => { if(loaded < imgs.length) { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(()=>document.body.removeChild(iframe),2000); }}, 5000);
    } else {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(()=>document.body.removeChild(iframe),1000);
    }
  };

  const exportMail = () => {
    const data=buildExportData();if(data.length===0) return;
    const isEN=exportLang==="EN";
    const subject=encodeURIComponent(isEN?`Shipment Plan ${selYear}`:`Sevkiyat Planı ${selYear}`);
    const body=data.map(d=>{
      const lines=[`${isEN?"Date":"Tarih"}: ${fmtDate(d.date)} — ${Math.round(d.totalKG).toLocaleString()} KG`,""];
      d.items.forEach(it=>lines.push(`  ${it.name}: ${it.qty} ${isEN?"pcs":"ad"} (${Math.round(it.totalKG).toLocaleString()} KG)`));
      lines.push(`\n  ${isEN?"TOTAL":"TOPLAM"}: ${Math.round(d.totalKG).toLocaleString()} KG\n${"—".repeat(40)}`);
      return lines.join("\n");
    }).join("\n\n");
    window.open(`mailto:?subject=${subject}&body=${encodeURIComponent(body)}`);
  };

  const addContainer = () => {
    if(!newCDate) return;
    const id=`c${selYear.toString().slice(2)}-${Date.now()}`;
    setYearsData(prev=>{
      const y={...prev[selYear]};
      const cs=[...y.containers,{id,date:newCDate,shipped:false}].sort((a,b)=>new Date(a.date)-new Date(b.date));
      return{...prev,[selYear]:{...y,containers:cs}};
    });
    setShowAddC(false);setNewCDate("");
  };

  const addProduct = () => {
    if(!newP.nameTR||!newP.nameEN||!newP.kg||!newP.vioCode) return;
    const id=Math.max(...products.map(p=>p.id))+1;
    const colors=["#3B8BD4","#1D9E75","#D85A30","#D4537E","#534AB7","#639922","#BA7517","#E24B4A"];
    setProducts(prev=>[...prev,{id,nameTR:newP.nameTR,nameEN:newP.nameEN||newP.nameTR,kg:parseFloat(newP.kg),color:colors[id%colors.length]}]);
    // Save packing standard if provided
    const qpp = parseInt(newP.qtyPerPallet)||0;
    if(qpp > 0) {
      setPackingStandards(prev=>({...prev,[id]:{qtyPerPallet:qpp,ambalajType:newP.ambalajType||0,dara:parseFloat(newP.dara)||AMBALAJ_TYPES[newP.ambalajType||0].defaultDara}}));
    }
    setShowAddP(false);setNewP({nameTR:"",nameEN:"",kg:"",vioCode:"",qtyPerPallet:"",ambalajType:0,dara:""});
  };

  const currentYear = new Date().getFullYear();
  const allowedYears = [currentYear, currentYear+1]; // 2026, 2027

  const addOrder = () => {
    if(!orderPid||!orderQty) return;
    if(!allowedYears.includes(orderYear)) return;
    const pid=Number(orderPid);
    const qty=parseInt(orderQty);
    setYearsData(prev=>{
      const y={...(prev[orderYear]||{containers:[],orders:{},carryOver:{},quantities:{}})};
      const orders={...y.orders,[pid]:(y.orders[pid]||0)+qty};
      // Cascade to linked children
      combRules.filter(r=>r.parent===pid).forEach(rule=>{
        rule.children.forEach(childId=>{
          orders[childId]=(orders[childId]||0)+qty;
        });
      });
      return{...prev,[orderYear]:{...y,orders}};
    });
    setShowAddO(false);setOrderPid("");setOrderQty("");
  };

  const saveSettings = () => { setMinKG(parseInt(tmpMin)||DEFAULT_MIN); setMaxKG(parseInt(tmpMax)||DEFAULT_MAX); setShowSettings(false); };

  const activeProducts = useMemo(() => {
    let ap = products.filter(p => {
      const s = getPStats(p.id);
      return s.order>0||s.planned>0;
    });
    if(search) {
      const q = search.toLowerCase();
      ap = ap.filter(p => p.nameTR.toLowerCase().includes(q)||p.nameEN.toLowerCase().includes(q));
    }
    // Group: 0=green (toBePlanned>0), 1=blue (toBePlanned=0 but remaining>0), 2=red (remaining<=0)
    ap.sort((a,b) => {
      const sa = getPStats(a.id), sb = getPStats(b.id);
      const ga = sa.toBePlanned>0?0:(sa.remaining>0?1:2);
      const gb = sb.toBePlanned>0?0:(sb.remaining>0?1:2);
      if(ga!==gb) return ga-gb;
      return b.kg-a.kg; // within group sort by kg desc
    });
    return ap;
  },[products,getPStats,search]);

  const getProductGroup = useCallback(pid => {
    const s = getPStats(pid);
    if(s.toBePlanned>0) return {id:0,label:"Planlanacak",color:"#1D9E75",bg:"#f3faf7",bgZ:"#ddf0e5",bgSel:"#b8e0cc"};
    if(s.remaining>0) return {id:1,label:"Sevk bekliyor",color:"#3B8BD4",bg:"#f0f6fc",bgZ:"#d9e8f5",bgSel:"#b5d4f0"};
    return {id:2,label:"Tamamlandı",color:"#E24B4A",bg:"#fdf3f3",bgZ:"#f5dede",bgSel:"#f0c8c8"};
  },[getPStats]);

  const dashData = useMemo(() => {
    const containerLoads = yd.containers.map(c=>{
      const kg=getCKG(c.id);const st=getStatus(kg);
      return{name:shortDate(c.date),kg:Math.round(kg),status:st.s,shipped:isShipped(c)};
    });
    const sc={shipped:0,planned:0,remaining:0};
    activeProducts.forEach(p=>{const s=getPStats(p.id);sc.shipped+=s.shipped;sc.planned+=s.pNotShipped;sc.remaining+=Math.max(0,s.toBePlanned);});
    const trend=[2024,2025,2026].map(y=>{
      const d=yearsData[y];if(!d) return{year:y.toString(),totalKG:0,containers:0};
      const totalKG=d.containers.reduce((s,c)=>{
        const q=d.quantities[c.id]||{};
        return s+Object.entries(q).reduce((ss,[pid,qty])=>{const p=products.find(pr=>pr.id===Number(pid));return ss+(p&&isShipped(c)?p.kg*qty:0);},0);
      },0);
      return{year:y.toString(),totalKG:Math.round(totalKG),containers:d.containers.filter(c=>isShipped(c)).length};
    });
    return{containerLoads,statusCounts:sc,yearlyTrend:trend};
  },[activeProducts,yd,yearsData,products,getPStats,getCKG,getStatus]);

  const totalShippedKG=useMemo(()=>yd.containers.filter(c=>isShipped(c)).reduce((s,c)=>s+getCKG(c.id),0),[yd,getCKG]);
  const totalPlannedKG=useMemo(()=>yd.containers.filter(c=>!isShipped(c)).reduce((s,c)=>s+getCKG(c.id),0),[yd,getCKG]);

  const pendingCarryOver = useMemo(()=>computeCarryOver(selYear),[computeCarryOver,selYear]);
  const hasPendingCO = Object.keys(pendingCarryOver).length > 0;

  // ============ PACKING FUNCTIONS ============
  const PALLET_MAX_KG = 1500;
  const AMBALAJ_TYPES = [{label:"Palet",defaultDara:15},{label:"Sandık",defaultDara:25},{label:"Karton Kutu",defaultDara:5}];

  const startEditStd = (pid) => {
    const std = packingStandards[pid];
    setEditStdTemp({
      qtyPerPallet: std?.qtyPerPallet || "",
      ambalajType: std?.ambalajType ?? 0,
      dara: std?.dara ?? AMBALAJ_TYPES[std?.ambalajType??0]?.defaultDara ?? 15
    });
    setEditStdPid(pid);
  };

  const saveEditStd = (pid) => {
    const qty = parseInt(editStdTemp.qtyPerPallet) || 0;
    if(qty > 0) {
      setPackingStandards(prev => ({...prev, [pid]: {
        qtyPerPallet: qty,
        ambalajType: editStdTemp.ambalajType,
        dara: parseFloat(editStdTemp.dara) || AMBALAJ_TYPES[editStdTemp.ambalajType].defaultDara
      }}));
    }
    setEditStdPid(null);
  };

  const openPacking = (cid) => {
    const q = yd.quantities[cid] || {};
    const items = Object.entries(q).filter(([,qty])=>qty>0).map(([pid,qty])=>{
      const p = products.find(pr=>pr.id===Number(pid));
      return p ? {pid:Number(pid),name:lang==="TR"?p.nameTR:p.nameEN,nameEN:p.nameEN,nameTR:p.nameTR,qty,kg:p.kg,totalKG:p.kg*qty} : null;
    }).filter(Boolean).sort((a,b)=>b.kg-a.kg);
    // Load existing packing data from Firestore state or start fresh
    const existingPacking = yearsData[selYear]?.packingData?.[cid];
    if(existingPacking && existingPacking.pallets && existingPacking.pallets.length > 0) {
      setPallets(existingPacking.pallets);
      setKantarBrut(existingPacking.kantarBrut || "");
      setKantarApplied(existingPacking.kantarApplied || false);
    } else {
      setPallets([]);
      setKantarBrut("");
      setKantarApplied(false);
    }
    setPackingCid(cid);
    setPage("packing");
  };

  const getPackingItems = () => {
    if(!packingCid) return [];
    const q = yd.quantities[packingCid] || {};
    return Object.entries(q).filter(([,qty])=>qty>0).map(([pid,qty])=>{
      const p = products.find(pr=>pr.id===Number(pid));
      return p ? {pid:Number(pid),nameTR:p.nameTR,nameEN:p.nameEN,qty,kg:p.kg} : null;
    }).filter(Boolean).sort((a,b)=>b.kg-a.kg);
  };

  const getUnpackedItems = () => {
    const allItems = getPackingItems();
    const packed = {};
    pallets.forEach(pl => pl.items.forEach(it => { packed[it.pid] = (packed[it.pid]||0) + it.qty; }));
    return allItems.map(it => ({...it, remaining: it.qty - (packed[it.pid]||0), packed: packed[it.pid]||0})).filter(it=>it.remaining>0);
  };

  const getPackedSummary = () => {
    const allItems = getPackingItems();
    const packed = {};
    pallets.forEach(pl => pl.items.forEach(it => { packed[it.pid] = (packed[it.pid]||0) + it.qty; }));
    return allItems.filter(it=>(packed[it.pid]||0)>=it.qty).map(it => {
      const palletCount = pallets.filter(pl=>pl.items.some(pi=>pi.pid===it.pid)).length;
      return {...it, palletCount};
    });
  };

  const getPalletNet = (pl) => pl.items.reduce((s,it)=>s+it.kg*it.qty,0);
  const getPalletBrut = (pl) => getPalletNet(pl) + (pl.dara||0);

  const autoDistribute = () => {
    const items = getPackingItems();
    const newPallets = [];
    let palletNum = 1;
    const packedPids = new Set(); // track which products are already packed (as children)

    // First pass: parent products with standards (+ their linked children)
    items.forEach(item => {
      if(packedPids.has(item.pid)) return; // already packed as child
      const std = packingStandards[item.pid];
      if(!std || !std.qtyPerPallet) return; // Skip items without standards
      
      // Find linked children for this product
      const childRules = combRules.filter(r => r.parent === item.pid);
      const childItems = childRules.flatMap(r => r.children.map(cid => items.find(it => it.pid === cid)).filter(Boolean));
      
      let remaining = item.qty;
      const qtyPer = std.qtyPerPallet;
      const ambType = std.ambalajType ?? 0;
      const dara = std.dara ?? AMBALAJ_TYPES[ambType].defaultDara;
      
      while(remaining > 0) {
        const fitQty = Math.min(remaining, qtyPer);
        const palletItems = [{pid:item.pid,nameTR:item.nameTR,nameEN:item.nameEN,qty:fitQty,kg:item.kg}];
        
        // Add linked children with same quantity
        childItems.forEach(child => {
          const childRemaining = child.qty - (newPallets.reduce((s,pl) => s + pl.items.filter(it=>it.pid===child.pid).reduce((ss,it)=>ss+it.qty,0), 0));
          if(childRemaining > 0) {
            const childQty = Math.min(fitQty, childRemaining);
            palletItems.push({pid:child.pid,nameTR:child.nameTR,nameEN:child.nameEN,qty:childQty,kg:child.kg});
          }
        });
        
        newPallets.push({
          id: palletNum++,
          items: palletItems,
          ambalajType: ambType,
          dara: dara
        });
        remaining -= fitQty;
      }
      
      // Mark children as packed
      childItems.forEach(child => packedPids.add(child.pid));
    });
    
    // Second pass: standalone products with standards (not yet packed)
    items.forEach(item => {
      if(packedPids.has(item.pid)) return;
      const std = packingStandards[item.pid];
      if(!std || !std.qtyPerPallet) return;
      // Check if already fully packed (e.g. as a child)
      const alreadyPacked = newPallets.reduce((s,pl) => s + pl.items.filter(it=>it.pid===item.pid).reduce((ss,it)=>ss+it.qty,0), 0);
      let remaining = item.qty - alreadyPacked;
      if(remaining <= 0) return;
      
      const qtyPer = std.qtyPerPallet;
      const ambType = std.ambalajType ?? 0;
      const dara = std.dara ?? AMBALAJ_TYPES[ambType].defaultDara;
      while(remaining > 0) {
        const fitQty = Math.min(remaining, qtyPer);
        newPallets.push({
          id: palletNum++,
          items:[{pid:item.pid,nameTR:item.nameTR,nameEN:item.nameEN,qty:fitQty,kg:item.kg}],
          ambalajType:ambType,
          dara:dara
        });
        remaining -= fitQty;
      }
    });
    
    newPallets.forEach((pl,i)=>pl.id=i+1);
    setPallets(newPallets);
    setKantarApplied(false);
  };

  const addPallet = () => {
    setPallets(prev=>[...prev,{id:prev.length+1,items:[],ambalajType:0,dara:AMBALAJ_TYPES[0].defaultDara}]);
  };

  const removePallet = (idx) => {
    setPallets(prev=>{
      const np=[...prev];
      np.splice(idx,1);
      np.forEach((pl,i)=>pl.id=i+1);
      return np;
    });
    setKantarApplied(false);
  };

  const addItemToPallet = (palletIdx, pid, qty) => {
    const p = products.find(pr=>pr.id===pid);
    if(!p) return;
    // Collect items to add: main + linked children
    const itemsToAdd = [{pid, nameTR:p.nameTR, nameEN:p.nameEN, qty, kg:p.kg}];
    const childRules = combRules.filter(r => r.parent === pid);
    if(childRules.length > 0) {
      const allItems = getPackingItems();
      const packed = {};
      pallets.forEach(pl => pl.items.forEach(it => { packed[it.pid] = (packed[it.pid]||0) + it.qty; }));
      childRules.forEach(rule => {
        rule.children.forEach(cid => {
          const child = allItems.find(it => it.pid === cid);
          if(child) {
            const childRemaining = child.qty - (packed[cid]||0);
            const childQty = Math.min(qty, childRemaining);
            if(childQty > 0) {
              const cp = products.find(pr=>pr.id===cid);
              if(cp) itemsToAdd.push({pid:cid, nameTR:cp.nameTR, nameEN:cp.nameEN, qty:childQty, kg:cp.kg});
            }
          }
        });
      });
    }
    setPallets(prev=>{
      const np = prev.map((pl,i)=>{
        if(i!==palletIdx) return pl;
        let updated = {...pl, items:[...pl.items]};
        itemsToAdd.forEach(item => {
          const existing = updated.items.find(it=>it.pid===item.pid);
          if(existing) {
            updated.items = updated.items.map(it=>it.pid===item.pid?{...it,qty:it.qty+item.qty}:it);
          } else {
            updated.items = [...updated.items, item];
          }
        });
        return updated;
      });
      return np;
    });
    setKantarApplied(false);
  };

  const removeItemFromPallet = (palletIdx, pid) => {
    setPallets(prev=>prev.map((pl,i)=>{
      if(i!==palletIdx) return pl;
      return {...pl, items: pl.items.filter(it=>it.pid!==pid)};
    }));
    setKantarApplied(false);
  };

  const updatePalletDara = (idx, val) => {
    setPallets(prev=>prev.map((pl,i)=>i===idx?{...pl,dara:parseFloat(val)||0}:pl));
    setKantarApplied(false);
  };

  const updatePalletAmbalaj = (idx, typeIdx) => {
    setPallets(prev=>prev.map((pl,i)=>i===idx?{...pl,ambalajType:typeIdx,dara:AMBALAJ_TYPES[typeIdx].defaultDara}:pl));
    setKantarApplied(false);
  };

  const totalPackingNet = pallets.reduce((s,pl)=>s+getPalletNet(pl),0);
  const totalPackingDara = pallets.reduce((s,pl)=>s+(pl.dara||0),0);
  const totalPackingBrut = totalPackingNet + totalPackingDara;

  const applyKantar = () => {
    const kb = parseFloat(kantarBrut);
    if(!kb || kb <= 0 || pallets.length === 0) return;
    const diff = kb - totalPackingBrut;
    setPallets(prev => {
      const totalB = prev.reduce((s,pl)=>s+getPalletBrut(pl),0);
      if(totalB === 0) return prev;
      // Round each pallet's dara to 1 decimal
      const updated = prev.map(pl => {
        const plBrut = getPalletBrut(pl);
        const ratio = plBrut / totalB;
        const adjustment = diff * ratio;
        return {...pl, dara: Math.round((pl.dara + adjustment)*10)/10};
      });
      // Fix rounding remainder on last (heaviest) pallet
      const newTotal = updated.reduce((s,pl)=>s+getPalletNet(pl)+(pl.dara||0),0);
      const remainder = Math.round((kb - newTotal)*10)/10;
      if(Math.abs(remainder) > 0.05 && updated.length > 0) {
        const lastIdx = updated.length - 1;
        updated[lastIdx] = {...updated[lastIdx], dara: Math.round((updated[lastIdx].dara + remainder)*10)/10};
      }
      return updated;
    });
    setKantarApplied(true);
  };

  const savePackingData = () => {
    if(!packingCid || !canPack) return;
    setYearsData(prev => {
      const y = {...prev[selYear]};
      const pd = {...(y.packingData||{})};
      pd[packingCid] = {pallets, kantarBrut, kantarApplied, savedAt: new Date().toISOString()};
      return {...prev, [selYear]: {...y, packingData: pd}};
    });
  };

  // Auto-save packing when pallets change
  useEffect(() => {
    if(page === "packing" && packingCid && pallets.length > 0 && canPack) {
      const t = setTimeout(()=>savePackingData(), 2000);
      return ()=>clearTimeout(t);
    }
  }, [pallets, kantarBrut, kantarApplied]);

  // Add qty dialog state
  const [addQtyDialog, setAddQtyDialog] = useState(null); // {pid, palletIdx, maxQty, name}
  const [addQtyValue, setAddQtyValue] = useState("");

  // ============ PDF GENERATION ============
  const DENMA_INFO = {
    name: "DENMA DIŞ TİCARET LTD.ŞTİ",
    address: "Fevzi Çakmak Mah. 10670 Sk. No:31/B Karatay - KONYA / TURKEY",
    tel: "+90 332 606 29 83",
    vd: "Selçuk V.D. 292 139 2109",
    web: "www.denma.com.tr",
    email: "bilgi@denma.com.tr"
  };
  const CUSTOMER = {
    name: "OFMER SRL.",
    country: "İtalya",
    city: "MILAN",
    address: "Via Achille Grandi 20056 Trezzo S/Adda",
    tel: "0039029090134",
    fax: "00390290964563"
  };

  const LOGO_DENMA = "data:image/png;base64,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";
  const LOGO_ISO = "data:image/png;base64,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";
  const LOGO_MADE = "data:image/png;base64,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";


  const generatePackingPDF = (pdfLang) => {
    if(!packingCid||pallets.length===0) return;
    const c = yd.containers.find(ct=>ct.id===packingCid);
    if(!c) return;
    const isEN = pdfLang === "EN";
    const title = isEN ? "PACK LIST" : "ÇEKİ LİSTESİ";
    const dateStr = c.date.split("-").reverse().join(".");
    const totalQty = pallets.reduce((s,pl)=>s+pl.items.reduce((ss,it)=>ss+it.qty,0),0);
    const fk = (v) => Math.round(Number(v)).toLocaleString("tr-TR");
    const fk2 = (v) => Number(v).toLocaleString("tr-TR",{minimumFractionDigits:1,maximumFractionDigits:1});

    let rows = "";
    pallets.forEach(pl => {
      const plNet = getPalletNet(pl);
      const plBrut = getPalletBrut(pl);
      const plQty = pl.items.reduce((s,it)=>s+it.qty,0);
      pl.items.forEach((it,ii) => {
        const name = isEN ? it.nameEN : it.nameTR;
        rows += `<tr>
          <td style="padding:4px 8px;font-weight:700">${ii===0?`<b>${pl.id}</b>  - PALET`:""}</td>
          <td style="text-align:right;padding:4px 8px">${it.qty}</td>
          <td style="text-align:right;padding:4px 8px">${fk2(it.kg*it.qty)}</td>
          <td style="padding:4px 8px"></td>
          <td style="padding:4px 8px">${name}</td>
        </tr>`;
      });
      rows += `<tr style="border-bottom:1.5px dotted #999">
        <td style="padding:3px 8px;font-style:italic;font-size:10px;color:#555">${isEN?"Total Pallet:":"Palet Toplam:"}</td>
        <td style="text-align:right;padding:3px 8px;font-style:italic">${plQty}</td>
        <td style="text-align:right;padding:3px 8px;font-style:italic">${fk2(plNet)}</td>
        <td style="text-align:right;padding:3px 8px;font-style:italic">${fk2(plBrut)}</td>
        <td></td>
      </tr>`;
    });

    rows += `<tr style="border-top:2.5px solid #000;font-weight:700">
      <td style="padding:5px 8px">${isEN?"Total :":"Toplam :"}</td>
      <td style="text-align:right;padding:5px 8px">${totalQty}</td>
      <td style="text-align:right;padding:5px 8px">${fk(totalPackingNet)}</td>
      <td style="text-align:right;padding:5px 8px">${fk(totalPackingBrut)}</td>
      <td></td>
    </tr>`;

    const header = `<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
      <div>
        <img src="${LOGO_DENMA}" style="width:180px;height:auto" alt="DENMA"/>
      </div>
      <div style="text-align:right;font-size:9.5px;line-height:1.6">
        <b>${DENMA_INFO.name}</b><br>
        ${DENMA_INFO.address}<br>
        Tel: ${DENMA_INFO.tel}<br>
        ${DENMA_INFO.vd}<br>
        ${DENMA_INFO.web} &nbsp; ${DENMA_INFO.email}
      </div>
    </div>`;

    const html = `<div style="font-family:Arial,sans-serif;font-size:11px;color:#000;max-width:780px;margin:0 auto;padding:20px">
      ${header}
      <div style="display:flex;margin-bottom:16px;border:1px solid #000">
        <div style="flex:1;padding:10px 12px">
          <div style="font-weight:700;font-size:12px">${CUSTOMER.name}</div>
          <div style="margin-top:4px">${CUSTOMER.address}</div>
          <div style="margin-top:6px"><b>${CUSTOMER.city}</b> &nbsp;&nbsp;&nbsp; ${CUSTOMER.country}</div>
          <div style="margin-top:2px">${CUSTOMER.tel} &nbsp;&nbsp;&nbsp; ${CUSTOMER.fax}</div>
        </div>
        <div style="border-left:1px solid #000;padding:10px 14px;min-width:220px">
          <div style="font-size:26px;font-weight:900;margin-bottom:8px">${title}</div>
          <table style="font-size:11px">
            <tr><td style="font-weight:700;padding:2px 12px 2px 0">${isEN?"Date":"Tarih"}</td><td>: ${dateStr}</td></tr>
            <tr><td style="font-weight:700;padding:2px 12px 2px 0">${isEN?"Page":"Sayfa"}</td><td>: 1</td></tr>
          </table>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="border-bottom:2px solid #000">
          <th style="text-align:left;padding:5px 8px;font-size:10px">${isEN?"Pack Nr &amp;<br>Description":"Kap No ve<br>Açıklama"}</th>
          <th style="text-align:right;padding:5px 8px;font-size:10px">${isEN?"Quant.":"Miktar"}</th>
          <th style="text-align:right;padding:5px 8px;font-size:10px">${isEN?"Prod.Net<br>Kg":"Ürün Top.<br>Kg"}</th>
          <th style="text-align:right;padding:5px 8px;font-size:10px">${isEN?"Pallet Gross<br>Kg":"Palet Brüt<br>Kg"}</th>
          <th style="text-align:left;padding:5px 8px;font-size:10px">${isEN?"Product Description":"Ürün Açıklaması"}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:20px;font-size:12px;line-height:2">
        <div><b>${isEN?"Total Pack":"Toplam Kap"}</b> : &nbsp; ${pallets.length} Palet</div>
        <div><b>${isEN?"Total Net Weight":"Toplam Net Ağırlık"}</b> : &nbsp; ${fk(totalPackingNet)} Kg</div>
        <div><b>${isEN?"Total Gross Weight":"Toplam Brüt Ağırlık"}</b> : &nbsp; ${fk(totalPackingBrut)} Kg</div>
      </div>
      <div style="margin-top:20px;font-size:12px">
        <div><b>${isEN?"EXPORTER":"İHRACATÇI"}</b> : ${DENMA_INFO.name}</div>
        <div><b>${isEN?"IMPORTER":"İTHALATÇI"}</b> : ${CUSTOMER.name}</div>
      </div>
    </div>`;
    setPdfHtml(html);
  };

  const generatePalletLabelPDF = () => {
    if(!packingCid||pallets.length===0) return;
    const c = yd.containers.find(ct=>ct.id===packingCid);
    if(!c) return;
    const dateStr = c.date.split("-").reverse().join(".");
    const fk2 = (v) => Number(v).toLocaleString("tr-TR",{minimumFractionDigits:1,maximumFractionDigits:1});
    const properCase = (s) => s?s.charAt(0).toUpperCase()+s.slice(1).toLowerCase():"";

    const pages = pallets.map(pl => {
      const plNet = getPalletNet(pl);
      const plBrut = getPalletBrut(pl);
      const isHeavy = plBrut > 1500;

      let itemRows = "";
      pl.items.forEach((it,i) => {
        itemRows += `<tr>
          <td style="padding:2px 5px;text-align:center;border:1px solid #000;font-size:10px">${i+1}</td>
          <td style="padding:2px 5px;border:1px solid #000;font-size:10px">${it.nameEN}</td>
          <td style="padding:2px 5px;text-align:center;border:1px solid #000;font-size:10px">${it.qty}</td>
          <td style="padding:2px 5px;text-align:right;border:1px solid #000;font-size:10px">${fk2(it.kg*it.qty)}</td>
        </tr>`;
      });

      // QR code data: VIO codes + quantities
      const qrLines = pl.items.map(it => `${VIO_CODES[it.pid]||it.pid}: ${it.qty} pcs`);
      const qrData = `PALLET ${pl.id} | ${dateStr}\n${qrLines.join('\n')}\nNet: ${fk2(plNet)} Kg | Gross: ${fk2(plBrut)} Kg`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}`;

      return `<div class="label-page" style="width:100mm;height:200mm;padding:4mm 5mm;font-family:Arial,sans-serif;color:#000;box-sizing:border-box;page-break-after:always;overflow:hidden;${isHeavy?'border:3px solid #000;':''}">
        <!-- Header: Logo + Pallet No -->
        <div style="display:flex;justify-content:space-between;align-items:stretch;margin-bottom:2mm">
          <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
            <img src="${LOGO_DENMA}" style="width:36mm;height:auto;display:block" alt="DENMA"/>
            <div style="font-size:7px;margin-top:1.5mm;line-height:1.5">
              <b>${DENMA_INFO.name}</b><br>
              Fevzi Çakmak Mah. 10670 Sk. No:31/B<br>
              Karatay - KONYA / <b>TURKEY</b><br>
              Tel: ${DENMA_INFO.tel}<br>
              ${DENMA_INFO.web} — ${DENMA_INFO.email}
            </div>
          </div>
          <div style="border:2.5px solid #000;padding:2mm 6mm;text-align:center;margin-left:3mm">
            <div style="font-size:14px;font-weight:900;letter-spacing:1px">PALLET</div>
            <div style="font-size:52px;font-weight:900;line-height:1">${pl.id}</div>
          </div>
        </div>

        <!-- Date -->
        <div style="border:2px solid #000;padding:2mm 4mm;margin-bottom:2mm;text-align:center">
          <div style="font-size:20px;font-weight:800;letter-spacing:1px">${dateStr}</div>
        </div>

        <!-- Customer -->
        <div style="border:2px solid #000;padding:2mm 4mm;margin-bottom:2mm;text-align:center">
          <div style="font-size:10px">TO: <b>${CUSTOMER.name}</b></div>
          <div style="font-size:18px;font-weight:800;margin-top:1mm">${properCase(CUSTOMER.city)} / ITALY</div>
        </div>

        <!-- Heavy warning -->
        ${isHeavy?`<div style="border:2.5px solid #000;padding:2mm 4mm;margin-bottom:2mm;text-align:center;background:#000;color:#fff">
          <div style="font-size:16px;font-weight:900;letter-spacing:3px">⚠ HEAVY PALLET ⚠</div>
        </div>`:''}

        <!-- Product table (no Gross column) -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:2mm">
          <thead><tr style="background:#eee">
            <th style="padding:2px 5px;border:1px solid #000;font-size:8px;width:20px">Nr.</th>
            <th style="padding:2px 5px;border:1px solid #000;font-size:8px;text-align:left">Description</th>
            <th style="padding:2px 5px;border:1px solid #000;font-size:8px;width:35px">Qnt.</th>
            <th style="padding:2px 5px;border:1px solid #000;font-size:8px;text-align:right;width:55px">Net Kg</th>
          </tr></thead>
          <tbody>${itemRows}
            <tr style="background:#eee;font-weight:700">
              <td colspan="2" style="padding:2px 5px;border:1px solid #000;text-align:right;font-size:10px">Total :</td>
              <td style="padding:2px 5px;border:1px solid #000;text-align:center;font-size:10px">${pl.items.reduce((s,it)=>s+it.qty,0)}</td>
              <td style="padding:2px 5px;border:1px solid #000;text-align:right;font-size:10px">${fk2(plNet)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Weights -->
        <div style="border:2px solid #000;padding:2mm 4mm;margin-bottom:2mm">
          <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700">
            <span>Net Weight</span><span>${fk2(plNet)} Kg</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:${isHeavy?'16':'14'}px;font-weight:${isHeavy?'900':'700'};margin-top:1.5mm">
            <span>Gross Weight</span><span>${fk2(plBrut)} Kg${isHeavy?' ⚠':''}</span>
          </div>
        </div>

        <!-- Bottom: Made in Turkey + ISO text + QR Code — all same height -->
        <div style="display:flex;justify-content:space-between;align-items:center;height:20mm">
          <img src="${LOGO_MADE}" style="height:20mm;width:auto" alt="Made in Türkiye"/>
          <div style="border:1.5px solid #000;padding:1.5mm 3mm;text-align:center;font-size:7px;line-height:1.4;height:20mm;display:flex;flex-direction:column;justify-content:center">
            <div style="font-weight:900;font-size:8px;margin-bottom:1px">INTEGRATED<br>MANAGEMENT SYSTEM</div>
            <div>ISO 9001 · ISO 14001 · ISO 45001</div>
            <div style="font-size:6px;margin-top:1px">Quality · Environment · Health &amp; Safety</div>
          </div>
          <img src="${qrUrl}" style="width:20mm;height:20mm" alt="QR"/>
        </div>
      </div>`;
    });

    setPdfHtml(`<div data-label="true">${pages.join("")}</div>`);
  };

  const exportPackingExcel = (exLang) => {
    if(!packingCid||pallets.length===0) return;
    const c = yd.containers.find(ct=>ct.id===packingCid);
    if(!c) return;
    const isEN = exLang === "EN";
    const dateStr = c.date.split("-").reverse().join(".");

    const rows = [];
    // Header row
    rows.push([
      isEN?"Pack Nr":"Kap No",
      isEN?"Description":"Açıklama",
      isEN?"Quantity":"Miktar",
      isEN?"Net Kg":"Net Kg",
      isEN?"Tare Kg":"Dara Kg",
      isEN?"Gross Kg":"Brüt Kg"
    ]);

    pallets.forEach(pl => {
      const plNet = getPalletNet(pl);
      const plBrut = getPalletBrut(pl);
      pl.items.forEach((it,ii) => {
        rows.push([
          ii===0 ? `${pl.id} - ${isEN?"PALLET":"PALET"}` : "",
          isEN ? it.nameEN : it.nameTR,
          it.qty,
          Math.round(it.kg*it.qty*10)/10,
          ii===0 ? Math.round(pl.dara*10)/10 : "",
          ""
        ]);
      });
      // Pallet total row
      rows.push([
        isEN?"Pallet Total":"Palet Toplam",
        "",
        pl.items.reduce((s,it)=>s+it.qty,0),
        Math.round(plNet*10)/10,
        Math.round(pl.dara*10)/10,
        Math.round(plBrut*10)/10
      ]);
      rows.push([]); // Empty row between pallets
    });

    // Grand total
    const totalQty = pallets.reduce((s,pl)=>s+pl.items.reduce((ss,it)=>ss+it.qty,0),0);
    rows.push([
      isEN?"TOTAL":"TOPLAM",
      "",
      totalQty,
      Math.round(totalPackingNet),
      Math.round(totalPackingDara),
      Math.round(totalPackingBrut)
    ]);

    // Add header info rows at top
    const headerRows = [
      [DENMA_INFO.name],
      [DENMA_INFO.address],
      [`Tel: ${DENMA_INFO.tel}`],
      [],
      [isEN?"PACK LIST":"ÇEKİ LİSTESİ"],
      [`${isEN?"Date":"Tarih"}: ${dateStr}`],
      [],
      [`${isEN?"Customer":"Müşteri"}: ${CUSTOMER.name}`],
      [`${CUSTOMER.address}, ${CUSTOMER.city} / ${CUSTOMER.country}`],
      [],
      [`${isEN?"Total Pallets":"Toplam Palet"}: ${pallets.length}`],
      [`${isEN?"Total Net Weight":"Toplam Net Ağırlık"}: ${Math.round(totalPackingNet)} Kg`],
      [`${isEN?"Total Gross Weight":"Toplam Brüt Ağırlık"}: ${Math.round(totalPackingBrut)} Kg`],
      []
    ];

    const allRows = [...headerRows, ...rows];

    const ws = XLSX.utils.aoa_to_sheet(allRows);
    // Set column widths
    ws["!cols"] = [{wch:18},{wch:45},{wch:10},{wch:12},{wch:12},{wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isEN?"Pack List":"Çeki Liste");
    XLSX.writeFile(wb, `${isEN?"PackList":"CekiListe"}_${dateStr.replace(/\./g,"")}.xlsx`);
  };

  const nav=[{id:"planning",icon:"📋",l:"Sevkiyat Planı"},{id:"products",icon:"📦",l:"Ürünler"},{id:"import",icon:"📥",l:"VIO Import"},{id:"dashboard",icon:"📊",l:"Dashboard"},{id:"shipment",icon:"🚛",l:"Sevkiyat Detay"},{id:"montaj",icon:"🔧",l:"Montaj Planı"}];

  const iS={width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid var(--color-border-secondary)",background:"var(--color-background-secondary)",color:"var(--color-text-primary)",fontSize:13,outline:"none",boxSizing:"border-box"};
  const bP={padding:"8px 18px",borderRadius:8,border:"none",background:"#534AB7",color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer"};
  const bS={padding:"8px 18px",borderRadius:8,border:"1px solid var(--color-border-secondary)",background:"transparent",color:"var(--color-text-primary)",fontSize:13,cursor:"pointer"};

  return (
    authLoading ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f7f6f3"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:36,marginBottom:10}}>📦</div><div style={{fontSize:14,color:"#5f5e5a"}}>Yükleniyor...</div></div>
    </div>
    : !authUser ? <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"linear-gradient(135deg,#f7f6f3 0%,#e8f4ed 100%)"}}>
      <div style={{background:"#fff",borderRadius:16,padding:36,width:360,boxShadow:"0 8px 30px rgba(0,0,0,0.12)"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:40,marginBottom:8}}>📦</div>
          <h1 style={{fontSize:20,fontWeight:700,color:"#1a1a1a",margin:0}}>Sevkiyat Pro</h1>
          <p style={{fontSize:12,color:"#888780",marginTop:4}}>Sevkiyat Planlama ve Yönetim Sistemi</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={{fontSize:11,color:"#5f5e5a",display:"block",marginBottom:4}}>Email</label>
            <input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid rgba(0,0,0,0.15)",fontSize:13,outline:"none"}} placeholder="email@sirket.com"/>
          </div>
          <div>
            <label style={{fontSize:11,color:"#5f5e5a",display:"block",marginBottom:4}}>Şifre</label>
            <input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doLogin()}
              style={{width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid rgba(0,0,0,0.15)",fontSize:13,outline:"none"}} placeholder="••••••••"/>
          </div>
          {loginError&&<div style={{fontSize:11,color:"#E24B4A",padding:"6px 10px",background:"#fdf3f3",borderRadius:6}}>{loginError}</div>}
          <button onClick={doLogin} style={{padding:"10px",borderRadius:8,border:"none",background:"#534AB7",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",marginTop:4}}>Giriş Yap</button>
        </div>
      </div>
    </div>
    : <div style={{display:"flex",height:"100vh",fontFamily:"system-ui,sans-serif",color:"var(--color-text-primary)",background:"var(--color-background-tertiary)",overflow:"hidden"}}>
      {/* Sidebar */}
      <div style={{width:sidebar?210:52,background:"var(--color-background-primary)",borderRight:"1px solid var(--color-border-tertiary)",display:"flex",flexDirection:"column",transition:"width 0.2s",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:sidebar?"14px 14px 6px":"14px 8px 6px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>setSidebar(!sidebar)}>
          <div style={{width:30,height:30,borderRadius:8,background:"linear-gradient(135deg,#534AB7,#7F77DD)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,color:"#fff",fontWeight:700}}>SP</div>
          {sidebar&&<span style={{fontWeight:600,fontSize:14,whiteSpace:"nowrap"}}>Sevkiyat Pro</span>}
        </div>
        <div style={{flex:1,padding:"6px 0"}}>
          {nav.map(n=>(
            <div key={n.id} onClick={()=>setPage(n.id)} style={{display:"flex",alignItems:"center",gap:10,padding:sidebar?"9px 14px":"9px 14px",cursor:"pointer",background:page===n.id?"var(--color-background-info)":"transparent",fontSize:13,fontWeight:page===n.id?500:400,color:page===n.id?"var(--color-text-info)":"var(--color-text-secondary)",transition:"all 0.15s"}}>
              <span style={{fontSize:15,flexShrink:0}}>{n.icon}</span>
              {sidebar&&<span style={{whiteSpace:"nowrap"}}>{n.l}</span>}
            </div>
          ))}
        </div>
        {sidebar&&<div style={{padding:"10px 14px",borderTop:"1px solid var(--color-border-tertiary)",fontSize:10,color:"var(--color-text-tertiary)"}}>
          <div style={{display:"flex",gap:4,marginBottom:6}}>
            <button onClick={()=>setLang("TR")} style={{...bS,padding:"2px 8px",fontSize:10,fontWeight:lang==="TR"?600:400,background:lang==="TR"?"var(--color-background-info)":"transparent"}}>TR</button>
            <button onClick={()=>setLang("EN")} style={{...bS,padding:"2px 8px",fontSize:10,fontWeight:lang==="EN"?600:400,background:lang==="EN"?"var(--color-background-info)":"transparent"}}>EN</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:600,background:isAdmin?"rgba(83,74,183,0.15)":isPacker?"rgba(186,117,23,0.15)":isUretim?"rgba(29,158,117,0.15)":"rgba(136,135,128,0.15)",color:isAdmin?"#534AB7":isPacker?"#BA7517":isUretim?"#1D9E75":"#888780"}}>{isAdmin?"ADMİN":isPacker?"PAKETÇİ":isUretim?"ÜRETİM":"GÖRÜNTÜLEYICI"}</span>
            <span style={{fontSize:9,overflow:"hidden",textOverflow:"ellipsis"}}>{authUser?.email}</span>
          </div>
          <div style={{display:"flex",gap:4}}>
            {isAdmin&&<button onClick={()=>{setShowUserMgmt(true);loadUsers();}} style={{...bS,padding:"2px 6px",fontSize:9}}>Kullanıcılar</button>}
            <button onClick={doLogout} style={{...bS,padding:"2px 6px",fontSize:9,color:"#E24B4A"}}>Çıkış</button>
          </div>
        </div>}
      </div>

      {/* Main */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Top bar */}
        <div style={{padding:"8px 20px",background:"var(--color-background-primary)",borderBottom:"1px solid var(--color-border-tertiary)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,gap:8,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <h2 style={{margin:0,fontSize:15,fontWeight:600}}>{nav.find(n=>n.id===page)?.l}</h2>
            {(page==="planning"||page==="dashboard"||page==="shipment")&&<div style={{display:"flex",gap:3}}>
              {[2024,2025,2026,2027].map(y=>(
                <button key={y} onClick={()=>setSelYear(y)} style={{padding:"3px 12px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",background:selYear===y?"#534AB7":"transparent",color:selYear===y?"#fff":"var(--color-text-secondary)",fontSize:11,fontWeight:500,cursor:"pointer"}}>{y}</button>
              ))}
            </div>}
            {page==="planning"&&<input placeholder="Ürün ara..." value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,width:160,padding:"4px 10px",fontSize:11}}/>}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            {page==="planning"&&<>
              {isAdmin&&<div onClick={()=>{setTmpMin(minKG.toString());setTmpMax(maxKG.toString());setShowSettings(true);}} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:6,border:"1px solid var(--color-border-tertiary)",cursor:"pointer",fontSize:10,color:"var(--color-text-secondary)",background:"var(--color-background-secondary)"}}>
                <span>⚖</span><span>{minKG.toLocaleString()}–{maxKG.toLocaleString()} KG</span>
              </div>}
              {isAdmin&&hasPendingCO&&<button onClick={()=>doCarryOver(selYear,selYear+1)} style={{...bS,padding:"4px 10px",fontSize:10,color:"#BA7517",borderColor:"#BA7517"}} title={`${Object.keys(pendingCarryOver).length} ürün ${selYear+1}'e devredilecek`}>
                ↗ {selYear+1}'e Devret ({Object.keys(pendingCarryOver).length})
              </button>}
              {isAdmin&&allowedYears.includes(selYear)&&<button onClick={()=>setShowAddC(true)} style={{...bP,padding:"4px 14px",fontSize:11}}>+ Sevkiyat</button>}
              {isAdmin&&allowedYears.includes(selYear)&&<button onClick={()=>{setOrderYear(selYear);setShowAddO(true);}} style={{...bS,padding:"4px 14px",fontSize:11}}>+ Sipariş</button>}
              {isAdmin&&!allowedYears.includes(selYear)&&<span style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:"rgba(226,75,74,0.1)",color:"#E24B4A"}}>Geçmiş yıl — düzenleme kapalı</span>}
              <button onClick={()=>setHideShipped(!hideShipped)} style={{...bS,padding:"4px 10px",fontSize:10,color:hideShipped?"#1D9E75":"var(--color-text-secondary)",borderColor:hideShipped?"#1D9E75":"var(--color-border-secondary)",background:hideShipped?"rgba(29,158,117,0.08)":"transparent"}}>{hideShipped?"◉ Sevk gizli":"○ Sevk gizle"}</button>
            </>}
            {isAdmin&&page==="products"&&<button onClick={()=>setShowAddP(true)} style={bP}>+ Ürün</button>}
            {isAdmin&&page==="products"&&<button onClick={()=>setShowCombEdit(true)} style={{...bS,fontSize:13}}>+ Kombine</button>}
            {!isAdmin&&!isPacker&&<span style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:"rgba(29,158,117,0.1)",color:"#1D9E75"}}>Görüntüleme modu</span>}
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,overflow:"auto",padding:page==="planning"?0:20}}>
          {/* PLANNING GRID */}
          {page==="planning"&&<div style={{overflow:"auto",height:"100%"}}>
            <table style={{borderCollapse:"separate",borderSpacing:0,fontSize:11,minWidth:"100%"}}>
              <thead>
                <tr style={{position:"sticky",top:0,zIndex:20,boxShadow:"0 2px 6px rgba(0,0,0,0.08)"}}>
                  <th colSpan={6} style={{position:"sticky",left:0,zIndex:30,background:"#ffffff",padding:"4px 6px",textAlign:"left",borderBottom:"2px solid var(--color-border-tertiary)",fontSize:10,fontWeight:600,color:"var(--color-text-secondary)",minWidth:528,boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}}>
                    <span>KG </span><span style={{fontSize:9,fontWeight:400,color:"var(--color-text-tertiary)"}}>({minKG.toLocaleString()}–{maxKG.toLocaleString()})</span>
                  </th>
                  {visibleContainers.map((c,ci)=>{
                    const kg=getCKG(c.id);const st=getStatus(kg);const fill=maxKG>0?Math.min(kg/maxKG*100,100):0;
                    const shipped=isShipped(c);
                    const kgBg=shipped?"#e8e8e4":st.s==="ok"?"#e1f5ee":st.s==="close"?"#faeeda":st.s==="low"||st.s==="over"?"#fcebeb":"#ffffff";
                    return <th key={c.id} style={{background:kgBg,padding:"3px 3px",textAlign:"center",borderBottom:`2px solid ${shipped?"#888":st.c}`,minWidth:66,transition:"background 0.2s",opacity:shipped?0.7:1}}>
                      <div style={{fontSize:9,fontWeight:700,color:st.c}}>{st.i} {st.l}</div>
                      <div style={{fontSize:10,fontWeight:600,color:st.c}}>{Math.round(kg).toLocaleString()}</div>
                      <div style={{height:4,background:"var(--color-background-tertiary)",borderRadius:2,overflow:"hidden",position:"relative"}}>
                        <div style={{position:"absolute",left:`${maxKG>0?minKG/maxKG*100:0}%`,top:0,bottom:0,width:1,background:"var(--color-text-tertiary)",opacity:0.5,zIndex:1}}/>
                        <div style={{height:"100%",width:`${fill}%`,borderRadius:2,background:st.c,transition:"width 0.3s"}}/>
                      </div>
                    </th>;
                  })}
                  <th style={{background:"#ffffff",borderBottom:"2px solid var(--color-border-tertiary)",minWidth:45}}/>
                </tr>
                <tr style={{position:"sticky",top:46,zIndex:20,boxShadow:"0 2px 6px rgba(0,0,0,0.08)"}}>
                  <th style={{position:"sticky",left:0,zIndex:30,background:"#f7f6f3",padding:"6px 6px",textAlign:"left",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:10,fontWeight:600,minWidth:300}}>ÜRÜN</th>
                  <th style={{position:"sticky",left:300,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:42,color:"#D85A30"}} title="Önceki Yıldan Devir">DEVİR</th>
                  <th style={{position:"sticky",left:342,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:42,color:"#534AB7"}} title="Yeni Sipariş">YENİ</th>
                  <th style={{position:"sticky",left:384,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#0F6E56"}} title="Toplam Planlanan (sevk edilen dahil)">PLANLI</th>
                  <th style={{position:"sticky",left:432,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#BA7517"}} title="Planlanacak Kalan">P.KALAN</th>
                  <th style={{position:"sticky",left:480,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#E24B4A",boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}} title="Sevk Edilecek Kalan (toplam sipariş - sevk edilen)">S.KALAN</th>
                  {visibleContainers.map((c,ci)=>(
                    <th key={c.id} style={{background:isShipped(c)?"#e8e8e4":ci%2===0?"#f7f6f3":"#eeeee8",padding:"3px 2px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",minWidth:66,opacity:isShipped(c)?0.7:1}}>
                      {editDateId===c.id?<div>
                        <input type="date" value={editDateVal} onChange={e=>setEditDateVal(e.target.value)} onBlur={()=>saveDate(c.id)} onKeyDown={e=>{if(e.key==="Enter")saveDate(c.id);if(e.key==="Escape")setEditDateId(null);}} autoFocus style={{width:58,fontSize:9,padding:"2px",border:"1px solid #534AB7",borderRadius:3,background:"var(--color-background-primary)",color:"var(--color-text-primary)",outline:"none"}}/>
                      </div>
                      :<div onClick={()=>{if(isAdmin&&allowedYears.includes(selYear)){setEditDateId(c.id);setEditDateVal(c.date);}}} style={{cursor:isAdmin&&allowedYears.includes(selYear)?"pointer":"default"}} title={isAdmin&&allowedYears.includes(selYear)?"Tarihi değiştirmek için tıklayın":""}>
                        <div style={{fontSize:9,fontWeight:500}}>{shortDate(c.date)}</div>
                        <Badge status={isShipped(c)?"shipped":"planned"}/>
                      </div>}
                    </th>
                  ))}
                  <th style={{background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:45,color:"#1D9E75"}}>SVK</th>
                </tr>
              </thead>
              <tbody>
                {activeProducts.map((p,idx)=>{
                  const s=getPStats(p.id);
                  const g=getProductGroup(p.id);
                  const prevG=idx>0?getProductGroup(activeProducts[idx-1].id):null;
                  const showGroupHeader=!prevG||prevG.id!==g.id;
                  const colCount=6+visibleContainers.length+1;
                  const isSel=selectedRow===p.id;
                  const isZebra=idx%2===1;
                  const rowBg=isSel?g.bgSel:isZebra?g.bgZ:g.bg;
                  return <>{showGroupHeader&&<tr key={`gh-${g.id}`}><td colSpan={colCount} style={{padding:"6px 8px",background:g.bg,borderBottom:`2px solid ${g.color}`,position:"sticky",left:0,zIndex:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:g.color}}/>
                      <span style={{fontSize:11,fontWeight:600,color:g.color}}>{g.label}</span>
                      <span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>({activeProducts.filter(pp=>getProductGroup(pp.id).id===g.id).length} ürün)</span>
                    </div>
                  </td></tr>}
                  <tr key={p.id} onClick={()=>setSelectedRow(isSel?null:p.id)} style={{background:rowBg,cursor:"pointer",transition:"background 0.1s"}}>
                    <td style={{position:"sticky",left:0,zIndex:10,background:rowBg,padding:"4px 6px",borderBottom:"1px solid var(--color-border-tertiary)",borderLeft:`3px solid ${isSel?"#534AB7":g.color}`,whiteSpace:"nowrap"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:3,height:20,borderRadius:2,background:p.color,flexShrink:0}}/>
                        <div>
                          <div style={{fontSize:10,fontWeight:500,maxWidth:275,overflow:"hidden",textOverflow:"ellipsis"}} title={lang==="TR"?p.nameTR:p.nameEN}>
                            {isLinkedChild(p.id)&&<span style={{display:"inline-block",fontSize:7,padding:"1px 3px",borderRadius:3,background:"rgba(83,74,183,0.15)",color:"#534AB7",marginRight:3,verticalAlign:"middle",fontWeight:600}}>BAĞLI</span>}
                            {lang==="TR"?p.nameTR:p.nameEN}
                          </div>
                          <div style={{fontSize:8,color:"var(--color-text-tertiary)"}}>{p.kg}KG · Toplam:{s.order}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{position:"sticky",left:300,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:(yd.carryOver[p.id]||0)>0?"#D85A30":"var(--color-text-tertiary)"}}>{yd.carryOver[p.id]||"–"}</td>
                    <td onClick={(e)=>{e.stopPropagation();if(isAdmin&&allowedYears.includes(selYear)){setEditOrderPid(p.id);setEditOrderVal((yd.orders[p.id]||0).toString());}}} style={{position:"sticky",left:342,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:(yd.orders[p.id]||0)>0?"#534AB7":"var(--color-text-tertiary)",cursor:isAdmin&&allowedYears.includes(selYear)?"pointer":"default"}} title={!allowedYears.includes(selYear)?"Geçmiş yıl — sipariş düzenlenemez":""}>
                      {editOrderPid===p.id?<div>
                        <input type="number" autoFocus value={editOrderVal} onChange={e=>setEditOrderVal(e.target.value)} onBlur={()=>saveOrder(p.id)} onKeyDown={e=>{if(e.key==="Enter")saveOrder(p.id);if(e.key==="Escape")setEditOrderPid(null);}} style={{width:42,padding:"1px 2px",border:"1px solid #534AB7",borderRadius:3,textAlign:"center",fontSize:10,background:"var(--color-background-primary)",color:"var(--color-text-primary)",outline:"none"}}/>
                        <div style={{fontSize:7,color:"#BA7517"}}>min:{getPStats(p.id).planned}</div>
                      </div>
                      :(yd.orders[p.id]||0)>0?yd.orders[p.id]:"–"}
                    </td>
                    <td style={{position:"sticky",left:384,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.planned>0?"#0F6E56":"var(--color-text-tertiary)"}}>{s.planned}</td>
                    <td style={{position:"sticky",left:432,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.toBePlanned>0?"#BA7517":"var(--color-text-tertiary)"}}>{s.toBePlanned}</td>
                    <td style={{position:"sticky",left:480,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.remaining>0?"#E24B4A":"var(--color-text-tertiary)",boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}}>{s.remaining}</td>
                    {visibleContainers.map((c,ci)=>{
                      const q=(yd.quantities[c.id]||{})[p.id]||0;
                      const isE=editCell?.cid===c.id&&editCell?.pid===p.id;
                      const linked=isLinkedChild(p.id)&&q>0;
                      const extra=getExtra(c.id,p.id);
                      const linkedParents=linked?getLinkedParents(c.id,p.id):[];
                      const cascadeMin=isLinkedChild(p.id)?getCascadeQty(c.id,p.id,null,0):0;
                      const maxAllowed=s.toBePlanned+q;
                      const shipped=isShipped(c);
                      const colZebra=!shipped&&ci%2===1;
                      const cellBg=isE?"var(--color-background-info)":shipped?(isSel?"#d5d5d0":isZebra?"#ddddd8":"#e5e5e0"):isSel?g.bgSel:colZebra?(isZebra?g.bgSel:g.bgZ):rowBg;
                      return <td key={c.id} onClick={(e)=>{e.stopPropagation();if(!shipped&&s.toBePlanned+q>0)cellClick(c.id,p.id,q);}} style={{padding:"1px 1px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",cursor:shipped||(s.toBePlanned<=0&&q===0)?"default":"pointer",minWidth:66,background:cellBg,opacity:shipped?0.65:1}} title={linked?(extra>0?`Cascade: ${q-extra} + Ekstra: ${extra}`:`Bağlı: ${linkedParents.map(pid=>products.find(pp=>pp.id===pid)?.nameTR).join(" + ")}`):(s.toBePlanned<=0&&q===0?"Planlanacak kalan yok":"")}> 
                        {isE?(()=>{
                          const stdP = packingStandards[p.id];
                          const evNum = parseInt(editValue)||0;
                          const notMultiple = stdP?.qtyPerPallet>0 && evNum>0 && evNum%stdP.qtyPerPallet!==0;
                          return <div>
                          <input ref={inputRef} type="number" min={cascadeMin} max={maxAllowed} value={editValue} onChange={e=>setEditValue(e.target.value)} onBlur={cellSave} onKeyDown={cellKey} style={{width:48,padding:"1px 3px",border:`1px solid ${notMultiple?"#BA7517":"#534AB7"}`,borderRadius:3,textAlign:"center",fontSize:11,background:notMultiple?"#FAEEDA":"var(--color-background-primary)",color:"var(--color-text-primary)",outline:"none"}}/>
                          <div style={{fontSize:7,marginTop:1,display:"flex",justifyContent:"center",gap:4}}>
                            {cascadeMin>0&&<span style={{color:"#534AB7"}}>min:{cascadeMin}</span>}
                            <span style={{color:"#BA7517"}}>max:{maxAllowed}</span>
                          </div>
                          {notMultiple&&<div style={{fontSize:7,color:"#BA7517",marginTop:1,lineHeight:1.2}}>⚠ Palet katı değil ({stdP.qtyPerPallet}'er)</div>}
                        </div>;})()
                        :linked?<span style={{fontSize:10,fontWeight:500,color:"#534AB7"}}><span style={{fontSize:8}}>&#9741;</span> {q}{extra>0&&<span style={{fontSize:8,color:"#BA7517"}}> +{extra}</span>}</span>
                        :<span style={{fontSize:11,fontWeight:q>0?500:400,color:q>0?(isShipped(c)?"#1D9E75":"var(--color-text-primary)"):"var(--color-text-tertiary)"}}>{q>0?q:"·"}{q>0&&packingStandards[p.id]?.qtyPerPallet>0&&q%packingStandards[p.id].qtyPerPallet!==0&&<span style={{color:"#BA7517",fontSize:8}} title={`Palet katı değil (${packingStandards[p.id].qtyPerPallet}'er)`}> ⚠</span>}</span>}
                      </td>;
                    })}
                    <td style={{padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:11,color:"#1D9E75",background:rowBg}}>{s.shipped}</td>
                  </tr></>;
                })}
              </tbody>
            </table>
            {activeProducts.length===0&&<div style={{textAlign:"center",padding:50,color:"var(--color-text-tertiary)"}}><div style={{fontSize:36,marginBottom:10}}>📦</div>Bu yıl için sipariş bulunmuyor veya arama sonucu yok.</div>}
          </div>}

          {/* PRODUCTS - UNIFIED STOCK CARD */}
          {page==="products"&&<div>
            <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
              <input placeholder="Ürün ara..." value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,width:260,padding:"6px 12px"}}/>
              <span style={{fontSize:11,color:"var(--color-text-tertiary)"}}>{products.length} ürün · {Object.values(packingStandards).filter(s=>s.qtyPerPallet>0).length} standart · {combRules.length} kombine kural</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))",gap:10}}>
              {products.filter(p=>!search||p.nameTR.toLowerCase().includes(search.toLowerCase())||p.nameEN.toLowerCase().includes(search.toLowerCase())||String(p.id).includes(search)).sort((a,b)=>{
                const aAct=(getPStats(a.id).order>0||getPStats(a.id).planned>0)?0:1;
                const bAct=(getPStats(b.id).order>0||getPStats(b.id).planned>0)?0:1;
                if(aAct!==bAct) return aAct-bAct;
                const aStd=packingStandards[a.id]?.qtyPerPallet>0?0:1;
                const bStd=packingStandards[b.id]?.qtyPerPallet>0?0:1;
                if(aStd!==bStd) return aStd-bStd;
                return b.kg-a.kg;
              }).map(p=>{
                const std = packingStandards[p.id];
                const hasStd = std && std.qtyPerPallet > 0;
                const pSt = getPStats(p.id);
                const isActive = pSt.order>0||pSt.planned>0;
                const isChild = isLinkedChild(p.id);
                const parentRules = combRules.filter(r=>r.parent===p.id);
                const childOfRules = combRules.filter(r=>r.children.includes(p.id));
                const isEditingStd = editStdPid === p.id;

                return <div key={p.id} style={{background:"var(--color-background-primary)",borderRadius:10,padding:14,border:`1px solid ${hasStd?"rgba(29,158,117,0.3)":"var(--color-border-tertiary)"}`,opacity:isActive?1:0.5}}>
                  {/* Header */}
                  <div style={{display:"flex",gap:10,marginBottom:8}}>
                    <div style={{width:4,borderRadius:2,background:hasStd?"#1D9E75":p.color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2,flexWrap:"wrap"}}>
                        <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"var(--color-background-tertiary)",color:"var(--color-text-tertiary)",fontWeight:600}}>#{p.id}</span>
                        {isChild&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:"rgba(83,74,183,0.15)",color:"#534AB7",fontWeight:600}}>BAĞLI</span>}
                        {hasStd&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:"rgba(29,158,117,0.15)",color:"#0F6E56",fontWeight:600}}>STANDART</span>}
                        {parentRules.length>0&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:"rgba(83,74,183,0.15)",color:"#534AB7",fontWeight:600}}>KOMBİNE</span>}
                      </div>
                      <div style={{fontSize:12,fontWeight:500}}>{p.nameTR}</div>
                      <div style={{fontSize:10,color:"var(--color-text-tertiary)"}}>{p.nameEN}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{fontSize:16,fontWeight:600}}>{p.kg} <span style={{fontSize:10,fontWeight:400}}>KG</span></div>
                      {VIO_CODES[p.id]&&<div style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(83,74,183,0.1)",color:"#534AB7",fontFamily:"monospace",marginTop:2}}>{VIO_CODES[p.id]}</div>}
                    </div>
                  </div>

                  {/* Packing Standard */}
                  <div style={{background:"var(--color-background-secondary)",borderRadius:6,padding:"6px 10px",marginBottom:6,fontSize:11}}>
                    {isEditingStd?<div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{color:"var(--color-text-secondary)",fontSize:10}}>Adet/Palet:</span>
                        <input type="number" min="1" autoFocus value={editStdTemp.qtyPerPallet} onChange={e=>setEditStdTemp(prev=>({...prev,qtyPerPallet:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")saveEditStd(p.id);if(e.key==="Escape")setEditStdPid(null);}} style={{width:50,textAlign:"center",padding:"2px 4px",borderRadius:4,border:"2px solid #534AB7",fontSize:11}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{color:"var(--color-text-secondary)",fontSize:10}}>Ambalaj:</span>
                        <select value={editStdTemp.ambalajType} onChange={e=>{const v=Number(e.target.value);setEditStdTemp(prev=>({...prev,ambalajType:v,dara:AMBALAJ_TYPES[v].defaultDara}));}} style={{fontSize:10,padding:"2px 4px",borderRadius:4,border:"1px solid var(--color-border-secondary)"}}>
                          {AMBALAJ_TYPES.map((a,ai)=><option key={ai} value={ai}>{a.label}</option>)}
                        </select>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{color:"var(--color-text-secondary)",fontSize:10}}>Dara:</span>
                        <input type="number" value={editStdTemp.dara} onChange={e=>setEditStdTemp(prev=>({...prev,dara:e.target.value}))} style={{width:50,textAlign:"center",padding:"2px 4px",borderRadius:4,border:"1px solid var(--color-border-secondary)",fontSize:11}}/> kg
                      </div>
                      <button onClick={()=>saveEditStd(p.id)} style={{padding:"2px 10px",borderRadius:4,border:"1px solid #1D9E75",background:"rgba(29,158,117,0.08)",color:"#1D9E75",fontSize:10,fontWeight:500,cursor:"pointer"}}>Kaydet</button>
                      <button onClick={()=>setEditStdPid(null)} style={{padding:"2px 8px",borderRadius:4,border:"1px solid var(--color-border-secondary)",background:"transparent",fontSize:10,cursor:"pointer"}}>İptal</button>
                    </div>
                    :hasStd?<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{display:"flex",gap:12}}>
                        <span><b>{std.qtyPerPallet}</b> adet/palet</span>
                        <span>{AMBALAJ_TYPES[std.ambalajType??0].label}</span>
                        <span>Dara: {std.dara} kg</span>
                        <span style={{color:"#0F6E56",fontWeight:500}}>Palet: {Math.round(std.qtyPerPallet*p.kg+(std.dara||0))} kg</span>
                      </div>
                      <div style={{display:"flex",gap:4}}>
                        {canPack&&<button onClick={()=>startEditStd(p.id)} style={{padding:"1px 6px",borderRadius:3,border:"1px solid var(--color-border-secondary)",background:"transparent",fontSize:9,cursor:"pointer"}}>Düzenle</button>}
                        {canPack&&<button onClick={()=>{setPackingStandards(prev=>{const n={...prev};delete n[p.id];return n;});}} style={{padding:"1px 6px",borderRadius:3,border:"1px solid #E24B4A",background:"transparent",color:"#E24B4A",fontSize:9,cursor:"pointer"}}>Sil</button>}
                      </div>
                    </div>
                    :<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",color:"var(--color-text-tertiary)"}}>
                      <span>Paketleme standardı tanımlı değil</span>
                      {canPack&&<button onClick={()=>startEditStd(p.id)} style={{padding:"1px 8px",borderRadius:3,border:"1px solid #534AB7",background:"rgba(83,74,183,0.06)",color:"#534AB7",fontSize:9,cursor:"pointer"}}>Tanımla</button>}
                    </div>}
                  </div>

                  {/* Combine Rules */}
                  {parentRules.length>0&&<div style={{background:"rgba(83,74,183,0.04)",borderRadius:6,padding:"5px 10px",marginBottom:6,fontSize:10}}>
                    <span style={{color:"#534AB7",fontWeight:500}}>Kombine → </span>
                    {parentRules.flatMap(r=>r.children).map(cid=>{
                      const ch=products.find(pr=>pr.id===cid);
                      return ch?<span key={cid} style={{padding:"1px 6px",borderRadius:3,background:"rgba(83,74,183,0.1)",color:"#534AB7",marginLeft:4,fontSize:9}}>{ch.nameTR.substring(0,30)}</span>:null;
                    })}
                    {isAdmin&&<button onClick={()=>{setCombRules(prev=>prev.filter(r=>r.parent!==p.id));}} style={{marginLeft:8,padding:"0px 4px",borderRadius:3,border:"none",background:"transparent",color:"#E24B4A",fontSize:12,cursor:"pointer"}} title="Kombine kuralını sil">✕</button>}
                  </div>}
                  {childOfRules.length>0&&<div style={{background:"rgba(83,74,183,0.04)",borderRadius:6,padding:"5px 10px",marginBottom:6,fontSize:10}}>
                    <span style={{color:"#534AB7",fontWeight:500}}>Bağlı olduğu → </span>
                    {childOfRules.map(r=>{
                      const par=products.find(pr=>pr.id===r.parent);
                      return par?<span key={r.parent} style={{padding:"1px 6px",borderRadius:3,background:"rgba(83,74,183,0.1)",color:"#534AB7",marginLeft:4,fontSize:9}}>{par.nameTR.substring(0,30)}</span>:null;
                    })}
                  </div>}

                  {/* Active order info */}
                  {isActive&&<div style={{display:"flex",gap:10,fontSize:10,color:"var(--color-text-secondary)",marginTop:4}}>
                    <span>Sipariş: {pSt.order}</span>
                    <span>Sevk: {pSt.shipped}</span>
                    <span>Kalan: {pSt.remaining}</span>
                  </div>}
                </div>;
              })}
            </div>
          </div>}

          {/* VIO IMPORT */}
          {page==="import"&&isAdmin&&<div>
            <div style={{marginBottom:16,padding:14,borderRadius:10,background:"var(--color-background-info)",fontSize:12,color:"var(--color-text-info)"}}>
              VIO ERP'den aldığınız sipariş Excel'ini yükleyin. CODE sütunu ile ürünler otomatik eşleştirilir, miktarlar seçtiğiniz yıla eklenir.
            </div>
            
            {/* Year + File Upload */}
            <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap",alignItems:"flex-end"}}>
              <div>
                <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Sipariş yılı</label>
                <div style={{display:"flex",gap:6}}>
                  {[2024,2025,2026,2027].map(y=>(
                    <button key={y} onClick={()=>allowedYears.includes(y)&&setImportYear(y)} style={{padding:"8px 16px",borderRadius:6,border:`1px solid ${importYear===y?"#534AB7":"var(--color-border-tertiary)"}`,background:importYear===y?"#534AB7":"transparent",color:importYear===y?"#fff":allowedYears.includes(y)?"var(--color-text-primary)":"var(--color-text-tertiary)",fontSize:12,fontWeight:500,cursor:allowedYears.includes(y)?"pointer":"not-allowed",opacity:allowedYears.includes(y)?1:0.4}}>{y}</button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>VIO Excel dosyası</label>
                <input type="file" accept=".xlsx,.xls" onChange={handleVioImport} style={{fontSize:12}}/>
              </div>
            </div>

            {/* Import Preview */}
            {importData&&<div>
              {/* Matched Products */}
              <div style={{marginBottom:16}}>
                <h4 style={{fontSize:14,fontWeight:600,marginBottom:8,color:"#1D9E75"}}>✓ Eşleşen ürünler ({importData.matched.length})</h4>
                {importData.matched.length>0?<table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{borderBottom:"2px solid var(--color-border-tertiary)"}}>
                    <th style={{textAlign:"left",padding:"6px 8px",color:"var(--color-text-tertiary)"}}>VIO Kodu</th>
                    <th style={{textAlign:"left",padding:"6px 8px",color:"var(--color-text-tertiary)"}}>Ürün</th>
                    <th style={{textAlign:"right",padding:"6px 8px",color:"var(--color-text-tertiary)"}}>Import</th>
                    <th style={{textAlign:"right",padding:"6px 8px",color:"var(--color-text-tertiary)"}}>Mevcut</th>
                    <th style={{textAlign:"right",padding:"6px 8px",color:"var(--color-text-tertiary)"}}>Toplam</th>
                  </tr></thead>
                  <tbody>
                    {importData.matched.map((m,i)=>{
                      const existing=(yearsData[importYear]?.orders||{})[m.pid]||0;
                      return <tr key={i} style={{borderBottom:"1px solid var(--color-border-tertiary)",background:i%2===0?"transparent":"var(--color-background-secondary)"}}>
                        <td style={{padding:"5px 8px",fontFamily:"monospace",fontSize:10}}>{m.code}</td>
                        <td style={{padding:"5px 8px"}}>{m.name}</td>
                        <td style={{textAlign:"right",padding:"5px 8px",fontWeight:600,color:"#534AB7"}}>+{m.qty}</td>
                        <td style={{textAlign:"right",padding:"5px 8px",color:"var(--color-text-tertiary)"}}>{existing}</td>
                        <td style={{textAlign:"right",padding:"5px 8px",fontWeight:600,color:"#1D9E75"}}>{existing+m.qty}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>:<div style={{color:"var(--color-text-tertiary)",fontSize:11}}>Eşleşen ürün yok</div>}
              </div>

              {/* Unmatched Products */}
              {importData.unmatched.length>0&&<div style={{marginBottom:16}}>
                <h4 style={{fontSize:14,fontWeight:600,marginBottom:8,color:"#BA7517"}}>⚠ Tanınmayan ürünler ({importData.unmatched.length})</h4>
                <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:8}}>Bu ürünler VIO kodlarıyla eşleşmedi. Eklemek için TR isim, EN isim ve KG bilgilerini girip "Onayla" tıklayın.</div>
                {importNewProducts.map((np,i)=>(
                  <div key={i} style={{padding:12,marginBottom:8,borderRadius:8,border:`1px solid ${np.approved?"#1D9E75":"#BA7517"}`,background:np.approved?"rgba(29,158,117,0.05)":"rgba(186,117,23,0.05)"}}>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
                      <span style={{fontSize:10,fontFamily:"monospace",padding:"2px 6px",borderRadius:4,background:"var(--color-background-tertiary)"}}>{np.code}</span>
                      <span style={{fontSize:11,color:"var(--color-text-secondary)"}}>{np.desc}</span>
                      <span style={{fontSize:11,fontWeight:600,color:"#534AB7"}}>+{np.qty} adet</span>
                      {np.approved&&<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(29,158,117,0.15)",color:"#1D9E75",fontWeight:600}}>✓ Onaylandı</span>}
                    </div>
                    {!np.approved&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                      <div style={{flex:1,minWidth:150}}>
                        <label style={{fontSize:9,color:"var(--color-text-tertiary)"}}>TR İsim *</label>
                        <input value={np.nameTR} onChange={e=>{const v=e.target.value;setImportNewProducts(prev=>prev.map((p,j)=>j===i?{...p,nameTR:v}:p));}} style={{...iS,padding:"4px 8px",fontSize:11}}/>
                      </div>
                      <div style={{flex:1,minWidth:150}}>
                        <label style={{fontSize:9,color:"var(--color-text-tertiary)"}}>EN İsim *</label>
                        <input value={np.nameEN} onChange={e=>{const v=e.target.value;setImportNewProducts(prev=>prev.map((p,j)=>j===i?{...p,nameEN:v}:p));}} style={{...iS,padding:"4px 8px",fontSize:11}}/>
                      </div>
                      <div style={{width:80}}>
                        <label style={{fontSize:9,color:"var(--color-text-tertiary)"}}>KG *</label>
                        <input type="number" value={np.kg} onChange={e=>{const v=e.target.value;setImportNewProducts(prev=>prev.map((p,j)=>j===i?{...p,kg:v}:p));}} style={{...iS,padding:"4px 8px",fontSize:11}}/>
                      </div>
                      <button onClick={()=>approveNewProduct(i)} style={{...bP,padding:"5px 12px",fontSize:10}}>Onayla</button>
                    </div>}
                  </div>
                ))}
              </div>}

              {/* Import Button */}
              <div style={{display:"flex",gap:10,alignItems:"center",padding:14,borderRadius:10,background:"var(--color-background-secondary)",marginTop:16}}>
                <div style={{flex:1,fontSize:12}}>
                  <b>{importData.matched.length}</b> eşleşen ürün{importNewProducts.filter(np=>np.approved).length>0&&` + ${importNewProducts.filter(np=>np.approved).length} yeni ürün`} <b>{importYear}</b> yılına eklenecek.
                </div>
                <button onClick={()=>{setImportData(null);setImportNewProducts([]);}} style={{...bS,padding:"8px 16px",fontSize:12}}>İptal</button>
                <button onClick={executeImport} style={{...bP,padding:"8px 20px",fontSize:12}}>Siparişleri Aktar</button>
              </div>
            </div>}
            
            {!importData&&<div style={{textAlign:"center",padding:40,color:"var(--color-text-tertiary)"}}>
              <div style={{fontSize:36,marginBottom:10}}>📥</div>
              <div style={{fontSize:13}}>VIO'dan export aldığınız Excel dosyasını yükleyin</div>
              <div style={{fontSize:11,marginTop:6}}>Dosyada CODE ve QUANTITY sütunları olmalıdır</div>
            </div>}
          </div>}
          {page==="import"&&!isAdmin&&<div style={{textAlign:"center",padding:40,color:"var(--color-text-tertiary)"}}>
            <div style={{fontSize:36,marginBottom:10}}>🔒</div>
            <div style={{fontSize:13}}>VIO import sadece admin tarafından yapılabilir</div>
          </div>}

          {/* DASHBOARD */}
          {page==="dashboard"&&(()=>{
            const shippedC=yd.containers.filter(c=>isShipped(c)).length;
            const totalC=yd.containers.length;
            const plannedNotShippedC=yd.containers.filter(c=>!isShipped(c)).length;

            // Remaining containers needed: products with toBePlanned>0 need more containers
            const totalRemainingQty=activeProducts.reduce((s,p)=>{const st=getPStats(p.id);return s+Math.max(0,st.toBePlanned);},0);
            // Estimate remaining containers by avg KG per container
            const avgKGperC=(minKG+maxKG)/2;
            const remainingKG=activeProducts.reduce((s,p)=>{const st=getPStats(p.id);return s+Math.max(0,st.toBePlanned)*p.kg;},0);
            const estRemainingC=remainingKG>=minKG?(avgKGperC>0?Math.ceil(remainingKG/avgKGperC):0):0;

            // Remaining months in year
            // Months left: from last planned container to end of year
            const lastPlannedDate=yd.containers.length>0?new Date(yd.containers[yd.containers.length-1].date):new Date();
            const lastPlannedMonth=lastPlannedDate.getMonth(); // 0-based
            const monthsLeft=Math.max(1, 11-lastPlannedMonth); // months after last planned to December
            const avgPerMonth=monthsLeft>0?Math.ceil(estRemainingC/monthsLeft):0;
            const monthNames=["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"];
            const fromMonth=monthNames[Math.min(lastPlannedMonth+1,11)];
            const toMonth=monthNames[11];

            // Planlanacak kalan sevkiyat (containers that still need planning)
            const planlanacakKalanC=estRemainingC;
            const toplamKalanSevkiyat=plannedNotShippedC+estRemainingC;

            // Top 5 by shipped weight
            const top5=activeProducts.map(p=>{
              const st=getPStats(p.id);
              return{name:p.nameTR.length>40?p.nameTR.slice(0,38)+"…":p.nameTR,kg:Math.round(st.shipped*p.kg),color:p.color,id:p.id};
            }).sort((a,b)=>b.kg-a.kg).slice(0,5);

            // Shipment status by container count
            const statusByC={shipped:shippedC,planned:plannedNotShippedC,remaining:estRemainingC};

            // Per-product chart data (container by container)
            const selPid=dashProduct?Number(dashProduct):null;
            const selP=selPid?products.find(p=>p.id===selPid):null;
            const productChartData=selP?(()=>{
              const monthly={};
              yd.containers.forEach(c=>{
                const d=new Date(c.date);
                const yr=d.getFullYear();
                // Previous year's containers → group into January
                const key=yr<selYear?0:d.getMonth();
                if(!monthly[key]) monthly[key]={month:key,label:monthNames[key],adet:0,shipped:0,notShipped:0};
                const q=(yd.quantities[c.id]||{})[selP.id]||0;
                monthly[key].adet+=q;
                if(isShipped(c)) monthly[key].shipped+=q; else monthly[key].notShipped+=q;
              });
              return Object.values(monthly).sort((a,b)=>a.month-b.month).map(m=>({name:m.label,sevk:m.shipped,plan:m.notShipped}));
            })():[];

            const toplamSevkiyat=shippedC+toplamKalanSevkiyat;

            return <div>
            <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
              <KPI label="Sevk edilen / Toplam sevkiyat" value={`${shippedC} / ${totalC}`} sub={`${plannedNotShippedC} planlanmış sevkiyat bekliyor`} accent="#1D9E75"/>
              <KPI label="Kalan / Toplam sevkiyat" value={`${toplamKalanSevkiyat} / ${toplamSevkiyat}`} sub={`${plannedNotShippedC} planlanmış + ${estRemainingC} planlanmamış`} accent="#E24B4A"/>
              <KPI label="Planlanacak kalan sevkiyat" value={planlanacakKalanC} sub={`~${Math.round(remainingKG).toLocaleString()} KG · Aylık ort. ${avgPerMonth} sevkiyat (${fromMonth}–${toMonth}, ${monthsLeft} ay)`} accent="#BA7517"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <div style={{background:"var(--color-background-primary)",borderRadius:12,padding:16,border:"1px solid var(--color-border-tertiary)",gridColumn:"1/3"}}>
                <h4 style={{margin:"0 0 12px",fontSize:13,fontWeight:500}}>En çok sevk edilen (KG)</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={top5} layout="vertical" margin={{left:20,right:20}}>
                    <XAxis type="number" tick={{fontSize:9}}/>
                    <YAxis dataKey="name" type="category" tick={{fontSize:10}} width={260}/>
                    <Tooltip formatter={v=>`${v.toLocaleString()} KG`}/>
                    <Bar dataKey="kg" radius={[0,4,4,0]} barSize={24}>
                      {top5.map((e,i)=><Cell key={i} fill={e.color}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{background:"var(--color-background-primary)",borderRadius:12,padding:16,border:"1px solid var(--color-border-tertiary)",gridColumn:"1/3"}}>
                <h4 style={{margin:"0 0 12px",fontSize:13,fontWeight:500}}>Sevkiyat durumu</h4>
                <div style={{display:"flex",alignItems:"center",gap:20}}>
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie data={[{name:"Sevk edildi",value:statusByC.shipped},{name:"Planlanmış",value:statusByC.planned},{name:"Planlanmamış",value:statusByC.remaining}]} cx="50%" cy="50%" outerRadius={75} innerRadius={40} dataKey="value" labelLine={false}>
                        <Cell fill="#1D9E75"/><Cell fill="#3B8BD4"/><Cell fill="#BA7517"/>
                      </Pie><Tooltip/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[{name:"Sevk edildi",value:statusByC.shipped,color:"#1D9E75"},{name:"Planlanmış",value:statusByC.planned,color:"#3B8BD4"},{name:"Planlanmamış",value:statusByC.remaining,color:"#BA7517"}].map((item,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:12,height:12,borderRadius:3,background:item.color,flexShrink:0}}/>
                        <span style={{fontSize:12,color:"var(--color-text-secondary)"}}>{item.name}</span>
                        <span style={{fontSize:14,fontWeight:600,color:item.color}}>{item.value}</span>
                      </div>
                    ))}
                    <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:4,borderTop:"1px solid var(--color-border-tertiary)",paddingTop:6}}>Toplam: {statusByC.shipped+statusByC.planned+statusByC.remaining} sevkiyat</div>
                  </div>
                </div>
              </div>
              <div style={{background:"var(--color-background-primary)",borderRadius:12,padding:16,border:"1px solid var(--color-border-tertiary)",gridColumn:"1/3"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <h4 style={{margin:0,fontSize:13,fontWeight:500}}>Ürün bazlı sevkiyat detayı</h4>
                  <select value={dashProduct} onChange={e=>setDashProduct(e.target.value)} style={{...iS,width:280,padding:"4px 8px",fontSize:11}}>
                    <option value="">Ürün seçin...</option>
                    {activeProducts.map(p=><option key={p.id} value={p.id}>{p.nameTR} ({p.kg} KG)</option>)}
                  </select>
                </div>
                {selP?<div>
                  <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                    {[{l:"Toplam sipariş",v:getPStats(selP.id).order,c:"#534AB7"},{l:"Planlanan",v:getPStats(selP.id).planned,c:"#0F6E56"},{l:"Sevk edilen",v:getPStats(selP.id).shipped,c:"#1D9E75"},{l:"Plan kalan",v:getPStats(selP.id).toBePlanned,c:"#BA7517"},{l:"Sevk kalan",v:getPStats(selP.id).remaining,c:"#E24B4A"}].map((k,i)=>
                      <div key={i} style={{fontSize:11,color:"var(--color-text-secondary)"}}>{k.l}: <span style={{fontWeight:600,color:k.c}}>{k.v}</span></div>
                    )}
                  </div>
                  <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:6}}>{selYear} aylık sevkiyat</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={productChartData}>
                      <XAxis dataKey="name" tick={{fontSize:10}}/><YAxis tick={{fontSize:9}} allowDecimals={false}/>
                      <Tooltip formatter={v=>`${v} adet`}/>
                      <Legend wrapperStyle={{fontSize:10}}/>
                      <Bar dataKey="sevk" stackId="a" fill="#1D9E75" name="Sevk edilen" radius={[0,0,0,0]}/>
                      <Bar dataKey="plan" stackId="a" fill="#3B8BD4" name="Planlanmış" radius={[3,3,0,0]}/>
                    </BarChart>
                  </ResponsiveContainer>
                  {(()=>{
                    const ys=YEARLY_SALES[selP.id];
                    const yearlyFromContainers={};
                    [2024,2025,2026,2027].forEach(y=>{
                      const yyd=yearsData[y];
                      if(!yyd) return;
                      let total=0;
                      yyd.containers.forEach(c=>{total+=((yyd.quantities[c.id]||{})[selP.id]||0);});
                      if(total>0) yearlyFromContainers[y]=total;
                    });
                    const allYears=new Set([...(ys?Object.keys(ys.data).map(Number):[]),...Object.keys(yearlyFromContainers).map(Number)]);
                    const chartData=[...allYears].sort().filter(y=>y<=2026).map(y=>({
                      year:y.toString(),
                      adet:ys?.data[y]??yearlyFromContainers[y]??0
                    }));
                    if(chartData.length===0) return null;
                    const maxVal=Math.max(...chartData.map(d=>d.adet));
                    const avgVal=Math.round(chartData.filter(d=>d.adet>0).reduce((s,d)=>s+d.adet,0)/Math.max(1,chartData.filter(d=>d.adet>0).length));
                    return <div style={{marginTop:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <span style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)"}}>Yıllara göre sevkiyat trendi (2016–2026)</span>
                        <span style={{fontSize:10,color:"var(--color-text-tertiary)"}}>Ort: {avgVal} · Max: {maxVal}</span>
                      </div>
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart data={chartData}>
                          <XAxis dataKey="year" tick={{fontSize:10}}/>
                          <YAxis tick={{fontSize:9}} allowDecimals={false}/>
                          <Tooltip formatter={v=>`${v} adet`}/>
                          <ReferenceLine y={avgVal} stroke="#BA7517" strokeDasharray="4 3" strokeWidth={1} label={{value:`Ort: ${avgVal}`,position:"insideTopRight",fontSize:9,fill:"#BA7517"}}/>
                          <Line type="monotone" dataKey="adet" stroke="#534AB7" strokeWidth={2} dot={{r:4,fill:"#534AB7"}} activeDot={{r:6}}/>
                        </LineChart>
                      </ResponsiveContainer>
                    </div>;
                  })()}
                </div>
                :<div style={{textAlign:"center",padding:40,color:"var(--color-text-tertiary)",fontSize:12}}>Detay görmek için yukarıdan ürün seçin</div>}
              </div>
            </div>
          </div>;})()}

          {/* SHIPMENT DETAIL */}
          {page==="shipment"&&<div>
            {/* Export toolbar */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              <button onClick={selectAllUnshipped} style={{...bS,padding:"5px 12px",fontSize:11}}>Sevk edilmemişleri seç</button>
              <button onClick={()=>setSelectedCids(new Set())} style={{...bS,padding:"5px 12px",fontSize:11}}>Seçimi temizle</button>
              <div style={{flex:1}}/>
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <span style={{fontSize:10,color:"var(--color-text-secondary)"}}>Dil:</span>
                <button onClick={()=>setExportLang("TR")} style={{...bS,padding:"2px 8px",fontSize:10,fontWeight:exportLang==="TR"?600:400,background:exportLang==="TR"?"var(--color-background-info)":"transparent"}}>TR</button>
                <button onClick={()=>setExportLang("EN")} style={{...bS,padding:"2px 8px",fontSize:10,fontWeight:exportLang==="EN"?600:400,background:exportLang==="EN"?"var(--color-background-info)":"transparent"}}>EN</button>
              </div>
              <button onClick={exportPDF} disabled={selectedCids.size===0} style={{...bP,padding:"5px 14px",fontSize:11,opacity:selectedCids.size===0?0.4:1}}>PDF ({selectedCids.size})</button>
              <button onClick={exportMail} disabled={selectedCids.size===0} style={{...bS,padding:"5px 14px",fontSize:11,opacity:selectedCids.size===0?0.4:1,color:selectedCids.size>0?"#534AB7":"var(--color-text-tertiary)"}}>Mail ({selectedCids.size})</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(480px,1fr))",gap:14}}>
            {[...yd.containers].sort((a,b)=>isShipped(a)===isShipped(b)?new Date(a.date)-new Date(b.date):isShipped(a)?1:-1).map(c=>{
              const kg=getCKG(c.id);const st=getStatus(kg);const fill=maxKG>0?Math.min(kg/maxKG*100,100):0;
              const shipped=isShipped(c);const sel=selectedCids.has(c.id);
              const items=Object.entries(yd.quantities[c.id]||{}).filter(([,q])=>q>0).map(([pid,qty])=>{
                const p=products.find(pr=>pr.id===Number(pid));return p?{name:lang==="TR"?p.nameTR:p.nameEN,qty,kg:p.kg,totalKG:p.kg*qty}:null;
              }).filter(Boolean).sort((a,b)=>b.kg-a.kg);
              return <div key={c.id} style={{background:"var(--color-background-primary)",borderRadius:12,padding:14,border:`2px solid ${sel?"#534AB7":st.s==="ok"?"#1D9E75":st.s==="empty"?"var(--color-border-tertiary)":"#E24B4A"}`,opacity:shipped?0.7:1,transition:"border 0.15s"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {!shipped&&<div onClick={()=>toggleCid(c.id)} style={{width:24,height:24,borderRadius:6,border:`2.5px solid ${sel?"#534AB7":"#888"}`,background:sel?"#534AB7":"var(--color-background-secondary)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"#fff",flexShrink:0,fontWeight:700,boxShadow:sel?"0 0 0 3px rgba(83,74,183,0.2)":"none",transition:"all 0.15s"}}>{sel?"✓":""}</div>}
                    <div style={{fontSize:13,fontWeight:600}}>{fmtDate(c.date)}</div>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <span style={{padding:"2px 6px",borderRadius:4,fontSize:10,fontWeight:600,background:st.bg,color:st.c}}>{st.i} {st.l}</span>
                    <Badge status={shipped?"shipped":"planned"}/>
                  </div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span style={{color:"var(--color-text-secondary)"}}>Toplam ağırlık</span>
                  <span style={{fontWeight:700,color:st.c}}>{Math.round(kg).toLocaleString()} KG</span>
                </div>
                <div style={{height:5,background:"var(--color-background-tertiary)",borderRadius:3,overflow:"hidden",marginBottom:10,position:"relative"}}>
                  <div style={{position:"absolute",left:`${maxKG>0?minKG/maxKG*100:0}%`,top:0,bottom:0,width:1,background:"var(--color-text-tertiary)",opacity:0.5}}/>
                  <div style={{height:"100%",width:`${fill}%`,borderRadius:3,background:st.c,transition:"width 0.3s"}}/>
                </div>
                {items.length>0?<table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{borderBottom:"1.5px solid var(--color-border-tertiary)"}}>
                    <th style={{textAlign:"left",padding:"4px 4px",color:"var(--color-text-tertiary)",fontWeight:600}}>Ürün</th>
                    <th style={{textAlign:"right",padding:"4px 4px",color:"var(--color-text-tertiary)",fontWeight:600,whiteSpace:"nowrap"}}>Adet</th>
                    <th style={{textAlign:"right",padding:"4px 4px",color:"var(--color-text-tertiary)",fontWeight:600,whiteSpace:"nowrap"}}>Birim KG</th>
                    <th style={{textAlign:"right",padding:"4px 4px",color:"var(--color-text-tertiary)",fontWeight:600,whiteSpace:"nowrap"}}>Toplam KG</th>
                  </tr></thead>
                  <tbody>
                    {items.map((it,i)=><tr key={i} style={{borderBottom:i<items.length-1?"1px solid var(--color-border-tertiary)":"none"}}>
                      <td style={{padding:"4px 4px",color:"var(--color-text-secondary)"}}>{it.name}</td>
                      <td style={{textAlign:"right",padding:"4px 4px",fontWeight:500}}>{it.qty}</td>
                      <td style={{textAlign:"right",padding:"4px 4px",color:"var(--color-text-tertiary)"}}>{it.kg}</td>
                      <td style={{textAlign:"right",padding:"4px 4px",fontWeight:500}}>{Math.round(it.totalKG).toLocaleString()}</td>
                    </tr>)}
                    <tr style={{borderTop:"2px solid var(--color-text-primary)"}}>
                      <td style={{padding:"5px 4px",fontWeight:700}}>TOPLAM</td><td></td><td></td>
                      <td style={{textAlign:"right",padding:"5px 4px",fontWeight:700}}>{Math.round(kg).toLocaleString()} KG</td>
                    </tr>
                  </tbody>
                </table>
                :<div style={{color:"var(--color-text-tertiary)",textAlign:"center",padding:10,fontSize:10}}>Boş</div>}
                {canPack&&items.length>0&&<div style={{marginTop:8,textAlign:"right"}}><button onClick={(e)=>{e.stopPropagation();openPacking(c.id);}} style={{padding:"5px 14px",borderRadius:6,border:"1.5px solid #534AB7",background:"rgba(83,74,183,0.08)",color:"#534AB7",fontSize:11,fontWeight:600,cursor:"pointer"}}>📦 Paketle</button></div>}
              </div>;
            })}
          </div></div>}


          {/* ========== MONTAJ PAGE ========== */}
          {page==="montaj"&&<MontajPlani db={db} yearsData={yearsData} products={products} userRole={userRole} selectedYear={selYear}/>}

          {/* ========== PACKING PAGE ========== */}
          {page==="packing"&&packingCid&&(()=>{
            const c = yd.containers.find(ct=>ct.id===packingCid);
            if(!c) return <div style={{padding:40,textAlign:"center",color:"var(--color-text-tertiary)"}}>Sevkiyat bulunamadı</div>;
            const unpacked = getUnpackedItems();
            const packedSummary = getPackedSummary();
            const totalItems = getPackingItems();
            const allPacked = unpacked.length === 0 && pallets.length > 0;
            const fmtKG = (v) => Number(v).toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2});
            const fmtKG1 = (v) => Number(v).toLocaleString("tr-TR",{minimumFractionDigits:1,maximumFractionDigits:1});
            const fmtKG0 = (v) => Math.round(Number(v)).toLocaleString("tr-TR");
            return <div>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <button onClick={()=>{savePackingData();setPage("shipment");setPackingCid(null);}} style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--color-border-secondary)",background:"transparent",fontSize:12,cursor:"pointer"}}>← Geri</button>
                  <div>
                    <div style={{fontSize:15,fontWeight:600}}>Paketleme — {fmtDate(c.date)}</div>
                    <div style={{fontSize:11,color:"var(--color-text-secondary)"}}>OFMER SRL. — {c.id}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <button onClick={autoDistribute} style={{padding:"5px 12px",borderRadius:6,border:"1.5px solid #1D9E75",background:"rgba(29,158,117,0.08)",color:"#0F6E56",fontSize:11,fontWeight:600,cursor:"pointer"}}>⚡ Otomatik Dağıt</button>
                  <button onClick={addPallet} style={{padding:"5px 12px",borderRadius:6,border:"1px solid var(--color-border-secondary)",background:"transparent",fontSize:11,cursor:"pointer"}}>+ Boş Palet</button>
                </div>
              </div>

              {/* Summary cards */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,marginBottom:14}}>
                <div style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Palet</div><div style={{fontSize:18,fontWeight:500}}>{pallets.length}</div></div>
                <div style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Net</div><div style={{fontSize:18,fontWeight:500}}>{fmtKG0(totalPackingNet)} kg</div></div>
                <div style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Dara</div><div style={{fontSize:18,fontWeight:500}}>{fmtKG0(totalPackingDara)} kg</div></div>
                <div style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"10px 12px"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Brüt</div><div style={{fontSize:18,fontWeight:500}}>{fmtKG0(totalPackingBrut)} kg</div></div>
              </div>

              {/* Kantar section */}
              <div style={{background:"var(--color-background-primary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,padding:"12px 16px",marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <span style={{fontSize:13,fontWeight:500}}>Kantar (gerçek ağırlık)</span>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="number" placeholder="Kantar brüt kg" value={kantarBrut} onChange={e=>setKantarBrut(e.target.value)} style={{width:150,padding:"6px 10px",borderRadius:6,border:"1px solid var(--color-border-secondary)",fontSize:12,outline:"none"}}/>
                    <button onClick={applyKantar} disabled={!kantarBrut||pallets.length===0} style={{padding:"6px 14px",borderRadius:6,border:"none",background:kantarApplied?"#1D9E75":"#534AB7",color:"#fff",fontSize:11,fontWeight:500,cursor:"pointer",opacity:(!kantarBrut||pallets.length===0)?0.4:1}}>{kantarApplied?"✓ Uygulandı":"Dengelemeyi Uygula"}</button>
                  </div>
                </div>
                {kantarBrut&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginTop:10}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Hesaplanan brüt</div><div style={{fontSize:16,fontWeight:500}}>{fmtKG0(totalPackingBrut)} kg</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Kantar brüt</div><div style={{fontSize:16,fontWeight:500,color:"var(--color-text-warning)"}}>{fmtKG0(parseFloat(kantarBrut)||0)} kg</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"var(--color-text-secondary)"}}>Fark</div><div style={{fontSize:16,fontWeight:500,color:Math.abs((parseFloat(kantarBrut)||0)-totalPackingBrut)<1?"#1D9E75":"#E24B4A"}}>{((parseFloat(kantarBrut)||0)-totalPackingBrut)>0?"+":""}{fmtKG0((parseFloat(kantarBrut)||0)-totalPackingBrut)} kg</div></div>
                </div>}
              </div>

              {/* Two panel layout */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,alignItems:"start"}}>

                {/* LEFT: Unpacked items */}
                <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,overflow:"hidden"}}>
                  <div style={{padding:"10px 14px",background:"var(--color-background-secondary)",borderBottom:"0.5px solid var(--color-border-tertiary)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:13,fontWeight:500}}>Paketlenmemiş ({unpacked.length})</span>
                    {unpacked.length>0&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"#FCEBEB",color:"#791F1F"}}>{fmtKG0(unpacked.reduce((s,it)=>s+it.remaining*it.kg,0))} kg bekliyor</span>}
                  </div>
                  <div style={{padding:10,maxHeight:400,overflow:"auto"}}>
                    {unpacked.length===0&&pallets.length>0&&<div style={{textAlign:"center",padding:20,color:"#1D9E75",fontSize:12,fontWeight:500}}>✓ Tüm ürünler paketlendi</div>}
                    {unpacked.length===0&&pallets.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--color-text-tertiary)",fontSize:12}}>Henüz paketleme başlamadı. "Otomatik Dağıt" veya "Boş Palet" ile başlayın.</div>}
                    {unpacked.map(it=>{
                      const itIsChild = isLinkedChild(it.pid);
                      const itIsParent = combRules.some(r=>r.parent===it.pid);
                      const childCount = itIsParent ? combRules.filter(r=>r.parent===it.pid).flatMap(r=>r.children).filter(cid=>unpacked.some(u=>u.pid===cid)).length : 0;
                      return <div key={it.pid} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,marginBottom:4,border:`0.5px solid ${itIsChild?"rgba(83,74,183,0.3)":"var(--color-border-tertiary)"}`,background:itIsChild?"rgba(83,74,183,0.03)":"transparent",fontSize:12}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:500,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                            {itIsChild&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:"rgba(83,74,183,0.15)",color:"#534AB7",marginRight:4,fontWeight:600}}>BAĞLI</span>}
                            {lang==="TR"?it.nameTR:it.nameEN}
                          </div>
                          <div style={{fontSize:10,color:"var(--color-text-secondary)"}}>
                            {it.remaining} ad kalan (toplam {it.qty}) — birim {it.kg} kg
                            {itIsChild&&<span style={{color:"#534AB7",marginLeft:4}}>· ana ürünle eklenir</span>}
                            {itIsParent&&childCount>0&&<span style={{color:"#534AB7",marginLeft:4}}>· +{childCount} bağlı ürün</span>}
                          </div>
                        </div>
                        <div style={{fontSize:11,fontWeight:500,whiteSpace:"nowrap"}}>{fmtKG0(it.remaining*it.kg)} kg</div>
                        {pallets.length>0&&!itIsChild&&<button onClick={()=>{setAddQtyDialog({pid:it.pid,palletIdx:null,maxQty:it.remaining,name:lang==="TR"?it.nameTR:it.nameEN});setAddQtyValue(String(it.remaining));}} style={{padding:"3px 8px",borderRadius:4,border:"1px solid #534AB7",background:"rgba(83,74,183,0.06)",color:"#534AB7",fontSize:10,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>Palete Ekle</button>}
                      </div>;
                    })}
                    {/* Packed summary */}
                    {packedSummary.length>0&&<div style={{borderTop:"0.5px solid var(--color-border-tertiary)",marginTop:10,paddingTop:10}}>
                      <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:6}}>Paketlenmiş ürünler</div>
                      {packedSummary.map(it=>(
                        <div key={it.pid} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",fontSize:11,opacity:0.5}}>
                          <div style={{flex:1}}>{lang==="TR"?it.nameTR:it.nameEN}</div>
                          <div>{it.qty} ad → {it.palletCount} palet</div>
                        </div>
                      ))}
                    </div>}
                  </div>
                </div>

                {/* RIGHT: Pallets */}
                <div style={{border:"0.5px solid var(--color-border-tertiary)",borderRadius:10,overflow:"hidden"}}>
                  <div style={{padding:"10px 14px",background:"var(--color-background-secondary)",borderBottom:"0.5px solid var(--color-border-tertiary)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:13,fontWeight:500}}>Paletler ({pallets.length})</span>
                    {pallets.length>0&&<span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"#EAF3DE",color:"#27500A"}}>{fmtKG0(totalPackingNet)} kg net</span>}
                  </div>
                  <div style={{padding:10,maxHeight:600,overflow:"auto"}}>
                    {pallets.length===0&&<div style={{textAlign:"center",padding:20,color:"var(--color-text-tertiary)",fontSize:12}}>Henüz palet yok</div>}
                    {pallets.map((pl,idx)=>{
                      const plNet = getPalletNet(pl);
                      const plBrut = getPalletBrut(pl);
                      const isOverWeight = plBrut > PALLET_MAX_KG;
                      const isKarma = pl.items.length > 1;
                      const weightPct = Math.min((plBrut/PALLET_MAX_KG)*100, 100);
                      return <div key={idx} style={{border:`1px solid ${isOverWeight?"#E24B4A":"var(--color-border-tertiary)"}`,borderRadius:8,marginBottom:10,overflow:"hidden"}}>
                        <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",background:isOverWeight?"#FCEBEB":"var(--color-background-secondary)",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:13,fontWeight:600}}>Palet {pl.id}</span>
                            {isKarma&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"#FAEEDA",color:"#633806"}}>Karma</span>}
                            {isOverWeight&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:"#FCEBEB",color:"#791F1F"}}>⚠ {fmtKG1(plBrut)} / {PALLET_MAX_KG} kg</span>}
                          </div>
                          <button onClick={()=>removePallet(idx)} style={{padding:"2px 8px",borderRadius:4,border:"1px solid #E24B4A",background:"transparent",color:"#E24B4A",fontSize:10,cursor:"pointer"}}>Sil</button>
                        </div>
                        <div style={{padding:"6px 10px"}}>
                          {pl.items.length===0&&<div style={{textAlign:"center",padding:10,color:"var(--color-text-tertiary)",fontSize:11}}>Boş palet — soldan ürün ekleyin</div>}
                          {pl.items.map(it=>(
                            <div key={it.pid} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"0.5px solid var(--color-border-tertiary)",fontSize:11}}>
                              <div style={{flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{lang==="TR"?it.nameTR:it.nameEN}</div>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span>{it.qty} ad</span>
                                <span style={{color:"var(--color-text-secondary)"}}>{fmtKG1(it.kg*it.qty)} kg</span>
                                <button onClick={()=>removeItemFromPallet(idx,it.pid)} style={{padding:"1px 5px",borderRadius:3,border:"1px solid var(--color-border-secondary)",background:"transparent",color:"var(--color-text-secondary)",fontSize:9,cursor:"pointer"}}>✕</button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* Ambalaj + dara */}
                        <div style={{display:"flex",gap:8,alignItems:"center",padding:"4px 12px",fontSize:11,color:"var(--color-text-secondary)"}}>
                          <span>Ambalaj:</span>
                          <select value={pl.ambalajType} onChange={e=>updatePalletAmbalaj(idx,Number(e.target.value))} style={{fontSize:11,padding:"2px 6px",borderRadius:4,border:"1px solid var(--color-border-secondary)"}}>
                            {AMBALAJ_TYPES.map((a,ai)=><option key={ai} value={ai}>{a.label}</option>)}
                          </select>
                          <span>Dara:</span>
                          <input type="number" value={pl.dara} onChange={e=>updatePalletDara(idx,e.target.value)} style={{width:55,fontSize:11,padding:"2px 6px",borderRadius:4,border:"1px solid var(--color-border-secondary)"}}/>
                          <span>kg</span>
                        </div>
                        {/* Footer + weight bar */}
                        <div style={{height:4,background:"var(--color-background-tertiary)",margin:"4px 12px",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${weightPct}%`,borderRadius:2,background:isOverWeight?"#E24B4A":weightPct>90?"#EF9F27":"#1D9E75",transition:"width 0.3s"}}/>
                        </div>
                        <div style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",fontSize:11,fontWeight:500,borderTop:"0.5px solid var(--color-border-tertiary)"}}>
                          <span>{pl.items.reduce((s,it)=>s+it.qty,0)} adet — Net: {fmtKG1(plNet)} kg</span>
                          <span>Brüt: {fmtKG1(plBrut)} kg</span>
                        </div>
                      </div>;
                    })}
                  </div>
                </div>
              </div>

              {/* PDF buttons */}
              {allPacked&&<div style={{display:"flex",gap:8,marginTop:14,justifyContent:"center",flexWrap:"wrap"}}>
                <button onClick={()=>generatePackingPDF("TR")} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>📄 Çeki Liste (TR)</button>
                <button onClick={()=>generatePackingPDF("EN")} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#185FA5",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>📄 Pack List (EN)</button>
                <button onClick={()=>exportPackingExcel("TR")} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#BA7517",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>📊 Excel (TR)</button>
                <button onClick={()=>exportPackingExcel("EN")} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#BA7517",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>📊 Excel (EN)</button>
                <button onClick={()=>generatePalletLabelPDF()} style={{padding:"8px 20px",borderRadius:8,border:"none",background:"#0F6E56",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>🏷 Palet Etiketi</button>
              </div>}
            </div>;
          })()}
        </div>
      </div>

      {/* Add Qty to Pallet Dialog */}
      {addQtyDialog&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setAddQtyDialog(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-background-primary)",borderRadius:12,padding:20,width:360,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <h3 style={{margin:"0 0 12px",fontSize:15,fontWeight:600}}>Palete Ekle</h3>
          <div style={{fontSize:12,color:"var(--color-text-secondary)",marginBottom:12}}>{addQtyDialog.name}</div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Adet (max: {addQtyDialog.maxQty})</label>
            <input type="number" value={addQtyValue} onChange={e=>setAddQtyValue(e.target.value)} min="1" max={addQtyDialog.maxQty} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid var(--color-border-secondary)",fontSize:13,outline:"none"}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Hedef palet</label>
            <select value={addQtyDialog.palletIdx===null?"":addQtyDialog.palletIdx} onChange={e=>setAddQtyDialog(d=>({...d,palletIdx:e.target.value===""?null:Number(e.target.value)}))} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid var(--color-border-secondary)",fontSize:12}}>
              <option value="">Yeni palet oluştur</option>
              {pallets.map((pl,i)=><option key={i} value={i}>Palet {pl.id} ({Math.round(getPalletBrut(pl))} kg)</option>)}
            </select>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setAddQtyDialog(null)} style={{padding:"8px 16px",borderRadius:6,border:"1px solid var(--color-border-secondary)",background:"transparent",fontSize:12,cursor:"pointer"}}>İptal</button>
            <button onClick={()=>{
              const qty = Math.min(parseInt(addQtyValue)||1, addQtyDialog.maxQty);
              if(qty<=0) return;
              if(addQtyDialog.palletIdx===null) {
                const newPl = {id:pallets.length+1,items:[],ambalajType:0,dara:AMBALAJ_TYPES[0].defaultDara};
                setPallets(prev=>{const np=[...prev,newPl];return np;});
                setTimeout(()=>addItemToPallet(pallets.length, addQtyDialog.pid, qty),50);
              } else {
                addItemToPallet(addQtyDialog.palletIdx, addQtyDialog.pid, qty);
              }
              setAddQtyDialog(null);
            }} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>Ekle</button>
          </div>
        </div>
      </div>}

      {/* Modals */}
      {showAddC&&<Modal title="Yeni Sevkiyat" onClose={()=>setShowAddC(false)}>
        <div style={{marginBottom:12}}><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Tarih</label>
          <input type="date" value={newCDate} onChange={e=>setNewCDate(e.target.value)} style={iS}/></div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>setShowAddC(false)} style={bS}>İptal</button>
          <button onClick={addContainer} style={bP}>Ekle</button>
        </div>
      </Modal>}

      {showAddP&&<Modal title="Yeni Ürün" onClose={()=>setShowAddP(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Adı (TR) *</label>
            <input value={newP.nameTR} onChange={e=>setNewP({...newP,nameTR:e.target.value})} style={iS} placeholder="Ürün adı Türkçe"/></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Adı (EN) *</label>
            <input value={newP.nameEN} onChange={e=>setNewP({...newP,nameEN:e.target.value})} style={iS} placeholder="Product name English"/></div>
          <div style={{display:"flex",gap:10}}>
            <div style={{flex:1}}><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Birim KG *</label>
              <input type="number" value={newP.kg} onChange={e=>setNewP({...newP,kg:e.target.value})} style={iS} placeholder="0"/></div>
            <div style={{flex:1}}><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>VIO Kodu *</label>
              <input value={newP.vioCode} onChange={e=>setNewP({...newP,vioCode:e.target.value})} style={iS} placeholder="152-XXXX"/></div>
          </div>
          <div style={{borderTop:"1px solid var(--color-border-tertiary)",paddingTop:10,marginTop:4}}>
            <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8}}>Paketleme Standardı (opsiyonel)</div>
            <div style={{display:"flex",gap:10}}>
              <div style={{flex:1}}><label style={{fontSize:11,color:"var(--color-text-tertiary)",display:"block",marginBottom:3}}>Adet / Palet</label>
                <input type="number" value={newP.qtyPerPallet} onChange={e=>setNewP({...newP,qtyPerPallet:e.target.value})} style={iS} placeholder="—"/></div>
              <div style={{flex:1}}><label style={{fontSize:11,color:"var(--color-text-tertiary)",display:"block",marginBottom:3}}>Ambalaj</label>
                <select value={newP.ambalajType} onChange={e=>setNewP({...newP,ambalajType:Number(e.target.value)})} style={iS}>
                  {AMBALAJ_TYPES.map((a,ai)=><option key={ai} value={ai}>{a.label}</option>)}
                </select></div>
              <div style={{flex:1}}><label style={{fontSize:11,color:"var(--color-text-tertiary)",display:"block",marginBottom:3}}>Dara (kg)</label>
                <input type="number" value={newP.dara} onChange={e=>setNewP({...newP,dara:e.target.value})} style={iS} placeholder={String(AMBALAJ_TYPES[newP.ambalajType||0].defaultDara)}/></div>
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={()=>setShowAddP(false)} style={bS}>İptal</button><button onClick={addProduct} style={bP}>Ekle</button></div>
      </Modal>}

      {/* Combine Rule Modal */}
      {showCombEdit&&<Modal title="Yeni Kombine Kural" onClose={()=>setShowCombEdit(false)}>
        <div style={{marginBottom:12,padding:10,borderRadius:8,background:"var(--color-background-info)",fontSize:11,color:"var(--color-text-info)"}}>
          Ana ürün planlandığında bağlı ürünler aynı miktarda otomatik eklenir ve birlikte paketlenir.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Ana ürün</label>
            <select value={newRuleParent} onChange={e=>setNewRuleParent(e.target.value)} style={iS}>
              <option value="">Seçin...</option>
              {products.filter(p=>!isLinkedChild(p.id)).map(p=><option key={p.id} value={p.id}>#{p.id} {p.nameTR} ({p.kg} KG)</option>)}
            </select></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Bağlı ürünler (virgülle ID)</label>
            <input value={newRuleChildren} onChange={e=>setNewRuleChildren(e.target.value)} style={iS} placeholder="Ürün ID'leri: 17, 14"/></div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>setShowCombEdit(false)} style={bS}>İptal</button>
          <button onClick={()=>{
            if(!newRuleParent||!newRuleChildren) return;
            const children=newRuleChildren.split(",").map(s=>parseInt(s.trim())).filter(n=>n>0);
            if(children.length===0) return;
            setCombRules(prev=>[...prev,{parent:parseInt(newRuleParent),children}]);
            setNewRuleParent("");setNewRuleChildren("");setShowCombEdit(false);
          }} style={bP}>Ekle</button>
        </div>
      </Modal>}

      {showAddO&&<Modal title="Sipariş Ekle" onClose={()=>setShowAddO(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Yıl</label>
            <div style={{display:"flex",gap:6}}>
              {[2024,2025,2026,2027].map(y=>(
                <button key={y} onClick={()=>allowedYears.includes(y)&&setOrderYear(y)} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${orderYear===y?"#534AB7":"var(--color-border-tertiary)"}`,background:orderYear===y?"#534AB7":"transparent",color:orderYear===y?"#fff":allowedYears.includes(y)?"var(--color-text-primary)":"var(--color-text-tertiary)",fontSize:12,fontWeight:500,cursor:allowedYears.includes(y)?"pointer":"not-allowed",opacity:allowedYears.includes(y)?1:0.4}}>{y}</button>
              ))}
            </div>
            {!allowedYears.includes(selYear)&&<div style={{fontSize:10,color:"#BA7517",marginTop:4}}>Görüntülediğiniz yıl ({selYear}) geçmiş yıl — sipariş girişi yapılamaz</div>}
          </div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Ürün</label>
            <select value={orderPid} onChange={e=>setOrderPid(e.target.value)} style={iS}>
              <option value="">Seçin...</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.nameTR} ({p.kg} KG)</option>)}
            </select></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Miktar</label>
            <input type="number" value={orderQty} onChange={e=>setOrderQty(e.target.value)} style={iS}/></div>
          <div style={{fontSize:10,color:"var(--color-text-tertiary)",padding:"6px 8px",background:"var(--color-background-secondary)",borderRadius:6}}>
            Sipariş <b>{orderYear}</b> yılına eklenecek. {orderPid&&(yearsData[orderYear]?.orders[Number(orderPid)]||0)>0&&`Mevcut: ${yearsData[orderYear].orders[Number(orderPid)]} adet → toplam: ${(yearsData[orderYear].orders[Number(orderPid)]||0)+parseInt(orderQty||0)} adet`}
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={()=>setShowAddO(false)} style={bS}>İptal</button><button onClick={addOrder} style={bP}>Ekle</button></div>
      </Modal>}

      {showSettings&&<Modal title="Tır Kapasite Ayarları" onClose={()=>setShowSettings(false)}>
        <div style={{marginBottom:14,padding:10,borderRadius:8,background:"var(--color-background-info)",fontSize:11,color:"var(--color-text-info)"}}>
          Sevkiyat bu aralıkta olmalıdır. Dışındakiler kırmızı (RED) işaretlenir.
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Minimum KG</label>
            <input type="number" value={tmpMin} onChange={e=>setTmpMin(e.target.value)} style={iS}/></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Maksimum KG</label>
            <input type="number" value={tmpMax} onChange={e=>setTmpMax(e.target.value)} style={iS}/></div>
          <div style={{display:"flex",gap:8,padding:"6px 0"}}>
            {[{l:"EKSİK",c:"#E24B4A",t:`< ${parseInt(tmpMin||0).toLocaleString()}`},{l:"ONAY",c:"#1D9E75",t:`${parseInt(tmpMin||0).toLocaleString()} – ${parseInt(tmpMax||0).toLocaleString()}`},{l:"FAZLA",c:"#E24B4A",t:`> ${parseInt(tmpMax||0).toLocaleString()}`}].map((x,i)=>(
              <div key={i} style={{flex:1,textAlign:"center",padding:6,borderRadius:6,background:`${x.c}15`}}>
                <div style={{fontSize:9,color:x.c,fontWeight:600}}>{x.l}</div>
                <div style={{fontSize:10,color:"var(--color-text-secondary)"}}>{x.t}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={()=>setShowSettings(false)} style={bS}>İptal</button><button onClick={saveSettings} style={bP}>Kaydet</button></div>
      </Modal>}

      {pdfHtml&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1100,display:"flex",flexDirection:"column",alignItems:"center",overflow:"auto"}}>
        <div style={{background:"#fff",width:"100%",maxWidth:800,margin:"20px auto",borderRadius:12,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:"var(--color-background-secondary)",borderBottom:"1px solid var(--color-border-tertiary)"}}>
            <span style={{fontWeight:600,fontSize:14,color:"var(--color-text-primary)"}}>PDF Önizleme</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={printPdf} style={{padding:"6px 16px",borderRadius:6,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>Yazdır / PDF Kaydet</button>
              <button onClick={()=>setPdfHtml(null)} style={{padding:"6px 16px",borderRadius:6,border:"1px solid var(--color-border-secondary)",background:"transparent",color:"var(--color-text-primary)",fontSize:12,cursor:"pointer"}}>Kapat</button>
            </div>
          </div>
          <div id="pdf-preview" style={{padding:10}} dangerouslySetInnerHTML={{__html:pdfHtml}}/>
        </div>
      </div>}

      {/* User Management Modal */}
      {showUserMgmt&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowUserMgmt(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-background-primary)",borderRadius:12,padding:24,width:500,maxHeight:"80vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <h3 style={{margin:"0 0 16px",fontSize:16,fontWeight:600}}>Kullanıcı Yönetimi</h3>

          {/* Existing Users List */}
          {allUsers.length>0&&<div style={{marginBottom:20}}>
            <div style={{fontSize:12,fontWeight:600,color:"var(--color-text-secondary)",marginBottom:8}}>Mevcut Kullanıcılar</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {allUsers.map(u=>{
                const roleColors = {admin:{bg:"rgba(83,74,183,0.1)",c:"#534AB7",l:"Admin"},packer:{bg:"rgba(186,117,23,0.1)",c:"#BA7517",l:"Paketçi"},uretim:{bg:"rgba(29,158,117,0.1)",c:"#1D9E75",l:"Üretim"},viewer:{bg:"rgba(136,135,128,0.1)",c:"#888780",l:"Görüntüleyici"}};
                const rc = roleColors[u.role]||roleColors.viewer;
                const isSelf = authUser && u.uid === authUser.uid;
                return <div key={u.uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,border:"1px solid var(--color-border-tertiary)",background:isSelf?"rgba(83,74,183,0.03)":"transparent"}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:500}}>{u.name||"—"} {isSelf&&<span style={{fontSize:9,color:"var(--color-text-tertiary)"}}>(sen)</span>}</div>
                    <div style={{fontSize:10,color:"var(--color-text-tertiary)"}}>{u.email}</div>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    {["admin","packer","uretim","viewer"].map(r=>{
                      const active = u.role === r;
                      const rc2 = roleColors[r];
                      return <button key={r} onClick={()=>{if(!isSelf&&!active)updateUserRole(u.uid,r);}} disabled={isSelf} style={{padding:"3px 8px",borderRadius:4,border:`1.5px solid ${active?rc2.c:"rgba(0,0,0,0.08)"}`,background:active?rc2.bg:"transparent",color:active?rc2.c:"var(--color-text-tertiary)",fontSize:9,fontWeight:active?600:400,cursor:isSelf?"not-allowed":"pointer",opacity:isSelf&&!active?0.3:1}}>{rc2.l}</button>;
                    })}
                  </div>
                </div>;
              })}
            </div>
          </div>}

          {/* New User Form */}
          <div style={{borderTop:allUsers.length>0?"1px solid var(--color-border-tertiary)":"none",paddingTop:allUsers.length>0?16:0}}>
            <div style={{fontSize:12,fontWeight:600,color:"var(--color-text-secondary)",marginBottom:10}}>Yeni Kullanıcı Ekle</div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>İsim</label>
                  <input value={newUserName} onChange={e=>setNewUserName(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="Ömer"/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Email</label>
                  <input type="email" value={newUserEmail} onChange={e=>setNewUserEmail(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="kullanici@sirket.com"/>
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Şifre</label>
                  <input type="password" value={newUserPass} onChange={e=>setNewUserPass(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="En az 6 karakter"/>
                </div>
                <div style={{flex:1}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Rol</label>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>setNewUserRole("admin")} style={{flex:1,padding:"6px",borderRadius:6,border:`2px solid ${newUserRole==="admin"?"#534AB7":"rgba(0,0,0,0.12)"}`,background:newUserRole==="admin"?"rgba(83,74,183,0.1)":"transparent",color:newUserRole==="admin"?"#534AB7":"var(--color-text-secondary)",fontSize:10,fontWeight:500,cursor:"pointer"}}>Admin</button>
                    <button onClick={()=>setNewUserRole("packer")} style={{flex:1,padding:"6px",borderRadius:6,border:`2px solid ${newUserRole==="packer"?"#BA7517":"rgba(0,0,0,0.12)"}`,background:newUserRole==="packer"?"rgba(186,117,23,0.1)":"transparent",color:newUserRole==="packer"?"#BA7517":"var(--color-text-secondary)",fontSize:10,fontWeight:500,cursor:"pointer"}}>Paketçi</button>
                    <button onClick={()=>setNewUserRole("uretim")} style={{flex:1,padding:"6px",borderRadius:6,border:`2px solid ${newUserRole==="uretim"?"#1D9E75":"rgba(0,0,0,0.12)"}`,background:newUserRole==="uretim"?"rgba(29,158,117,0.1)":"transparent",color:newUserRole==="uretim"?"#1D9E75":"var(--color-text-secondary)",fontSize:10,fontWeight:500,cursor:"pointer"}}>Üretim</button>
                    <button onClick={()=>setNewUserRole("viewer")} style={{flex:1,padding:"6px",borderRadius:6,border:`2px solid ${newUserRole==="viewer"?"#888780":"rgba(0,0,0,0.12)"}`,background:newUserRole==="viewer"?"rgba(136,135,128,0.1)":"transparent",color:newUserRole==="viewer"?"#888780":"var(--color-text-secondary)",fontSize:10,fontWeight:500,cursor:"pointer"}}>Görüntüleyici</button>
                  </div>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowUserMgmt(false)} style={{padding:"8px 16px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",background:"transparent",fontSize:12,cursor:"pointer"}}>Kapat</button>
              <button onClick={async()=>{await createUser();loadUsers();}} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>Kullanıcı Oluştur</button>
            </div>
          </div>
          {isAdmin&&!dataLoaded&&<div style={{marginTop:16,padding:10,background:"#faeeda",borderRadius:8}}>
            <div style={{fontSize:11,color:"#854F0B",marginBottom:6}}>Veritabanında veri bulunamadı. İlk kurulum için verileri yükleyin:</div>
            <button onClick={uploadInitialData} style={{padding:"6px 14px",borderRadius:6,border:"none",background:"#BA7517",color:"#fff",fontSize:11,fontWeight:500,cursor:"pointer"}}>Verileri Yükle</button>
          </div>}
        </div>
      </div>}

      {/* Initial data upload prompt */}
      {isAdmin&&authUser&&!dataLoaded&&!showUserMgmt&&<div style={{position:"fixed",bottom:20,right:20,background:"#fff",borderRadius:12,padding:16,boxShadow:"0 8px 30px rgba(0,0,0,0.15)",zIndex:1000,maxWidth:320}}>
        <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>İlk Kurulum</div>
        <div style={{fontSize:11,color:"var(--color-text-secondary)",marginBottom:10}}>Veritabanı boş. Excel verilerini Firestore'a yüklemek ister misiniz?</div>
        <button onClick={uploadInitialData} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer",width:"100%"}}>Verileri Yükle</button>
      </div>}
    </div>
  );
}


// ============================================================
// MontajPlani v2 — Tarih bazlı, sürekli takvim, kapasite kısıtlı
// ============================================================
function MontajPlani({ db, yearsData, products, userRole, selectedYear }) {
  const DC = "montajData"; const DD = "state";
  const isAdmin   = userRole === "admin";
  const isUretim  = userRole === "uretim";
  const canPlan   = isAdmin;
  const canActual = isAdmin || isUretim;

  // --- Sadece izlenen ürünler (5 ana model) ---
  const ANA_IDS = [1,2,3,4,5];
  const anaProducts = products.filter(p => ANA_IDS.includes(p.id));

  // --- State ---
  const [ms, setMs]           = useState({ initialStock:{}, days:{}, capacity:{hatMax:8, modelMax:{}} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tmpCap, setTmpCap]   = useState(null); // settings edit state

  const deepClone = o => JSON.parse(JSON.stringify(o));

  // --- Firestore yükle ---
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, DC, DD));
        if (snap.exists()) setMs(snap.data());
      } catch(e) { console.error(e); }
      setLoading(false);
    })();
  }, [db]);

  const save = async newState => {
    setSaving(true);
    try { await setDoc(doc(db, DC, DD), newState); setMs(newState); }
    catch(e) { alert("Kaydetme hatası: " + e.message); }
    setSaving(false);
  };

  // --- Takvim günleri: bugün-7 → son sevkiyat+14 ---
  const allContainers = useMemo(() => {
    const yd = yearsData[selectedYear] || {};
    return (yd.containers || []).slice().sort((a,b) => a.date.localeCompare(b.date));
  }, [yearsData, selectedYear]);

  const calDays = useMemo(() => {
    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(today); start.setDate(start.getDate() - 3);
    const lastC = allContainers.filter(c => !c.shipped).slice(-1)[0];
    const end = lastC ? new Date(lastC.date) : new Date(today);
    end.setDate(end.getDate() + 7);
    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(cur.toISOString().slice(0,10));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [allContainers]);

  // Sevkiyat tarihleri seti
  const shipDates = useMemo(() => new Set(allContainers.map(c => c.date)), [allContainers]);

  // Sevkiyat hedefleri (tüm aktif konteynerlerin toplamı, model bazında)
  const shipTargets = useMemo(() => {
    const totals = {};
    allContainers.filter(c => !c.shipped).forEach(c => {
      const yd = yearsData[selectedYear] || {};
      const q = yd.quantities?.[c.id] || {};
      ANA_IDS.forEach(pid => {
        const v = Number(q[pid]) || 0;
        if (v > 0) totals[pid] = (totals[pid] || 0) + v;
      });
    });
    return totals;
  }, [allContainers, yearsData, selectedYear]);

  // --- Stok hesabı ---
  const stockCalc = useMemo(() => {
    const { initialStock = {}, days = {} } = ms;
    const stock = {};
    ANA_IDS.forEach(pid => { stock[pid] = Number(initialStock[pid]) || 0; });
    // Tüm günlerin gerçekleşenlerini ekle
    Object.values(days).forEach(day => {
      ANA_IDS.forEach(pid => { stock[pid] += Number(day.actual?.[pid]) || 0; });
    });
    // Sevk edilmiş konteynerlerin miktarını düş
    allContainers.filter(c => c.shipped).forEach(c => {
      const yd = yearsData[selectedYear] || {};
      const q = yd.quantities?.[c.id] || {};
      ANA_IDS.forEach(pid => { stock[pid] -= Number(q[pid]) || 0; });
    });
    return stock;
  }, [ms, allContainers, yearsData, selectedYear]);

  // --- Toplam gerçekleşen (tüm takvim) ---
  const totalActuals = useMemo(() => {
    const t = {};
    ANA_IDS.forEach(pid => { t[pid] = 0; });
    Object.values(ms.days || {}).forEach(day => {
      ANA_IDS.forEach(pid => { t[pid] += Number(day.actual?.[pid]) || 0; });
    });
    return t;
  }, [ms]);

  // --- Hücre güncelle ---
  const updateCell = (date, pid, field, rawVal) => {
    const val = rawVal === "" ? 0 : Number(rawVal);
    if (isNaN(val) || val < 0) return;
    const newMs = deepClone(ms);
    if (!newMs.days) newMs.days = {};
    if (!newMs.days[date]) newMs.days[date] = { planned:{}, actual:{} };
    if (!newMs.days[date][field]) newMs.days[date][field] = {};
    newMs.days[date][field][String(pid)] = val;
    save(newMs);
  };

  const updateInitStock = (pid, rawVal) => {
    const val = rawVal === "" ? 0 : Number(rawVal);
    if (isNaN(val)) return;
    const newMs = deepClone(ms);
    if (!newMs.initialStock) newMs.initialStock = {};
    newMs.initialStock[String(pid)] = val;
    save(newMs);
  };

  const saveCapacity = () => {
    const newMs = deepClone(ms);
    newMs.capacity = deepClone(tmpCap);
    save(newMs);
    setShowSettings(false);
  };

  const fmtDate = d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit"});
  const GUNLER = ["Paz","Pzt","Sal","Çar","Per","Cum","Cmt"];
  const isWeekend = d => { const g = new Date(d).getDay(); return g===0||g===6; };
  const kisaAd = n => n.replace("REDÜKTÖR DİŞLİ TAKIMLARI ","").replace("REDÜKTÖR DİŞLİ TAKIMI ","");

  const hatMax = ms.capacity?.hatMax || 8;
  const getModelMax = pid => ms.capacity?.modelMax?.[pid] || 99;

  const TD  = { border:"0.5px solid var(--color-border-tertiary)", padding:0, margin:0 };
  const TH  = { ...TD, background:"var(--color-background-secondary)", fontWeight:500, fontSize:"11px", padding:"5px 4px", textAlign:"center", whiteSpace:"nowrap" };
  const INP = { width:"38px", textAlign:"center", border:"none", background:"transparent", fontSize:"12px", fontWeight:500, color:"var(--color-text-primary)", padding:"2px" };

  if (loading) return <div style={{padding:"3rem",textAlign:"center",color:"var(--color-text-secondary)"}}>Yükleniyor…</div>;

  const today = new Date().toISOString().slice(0,10);

  return (
    <div style={{padding:"1rem 1.25rem"}}>

      {/* Başlık */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
        <h2 style={{margin:0,fontSize:"17px",fontWeight:500}}>🔧 Montaj Planı</h2>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {saving && <span style={{fontSize:"12px",color:"var(--color-text-secondary)"}}>Kaydediliyor…</span>}
          {isAdmin && <button onClick={()=>{setTmpCap(deepClone(ms.capacity||{hatMax:8,modelMax:{}}));setShowSettings(true);}} style={{fontSize:"12px",padding:"5px 12px",cursor:"pointer"}}>⚙ Kapasite Ayarları</button>}
        </div>
      </div>

      {/* Stok kartları */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:6,marginBottom:"1rem"}}>
        {anaProducts.map(p => {
          const pid = p.id;
          const stock = stockCalc[pid] ?? 0;
          const isNeg = stock < 0;
          const target = shipTargets[pid] || 0;
          const actual = totalActuals[pid] || 0;
          const pct = target > 0 ? Math.min(100, Math.round((actual/target)*100)) : 0;
          const barColor = pct>=100?"var(--color-background-success)":pct>=60?"var(--color-background-warning)":"var(--color-background-danger)";
          return (
            <div key={pid} style={{background:"var(--color-background-secondary)",borderRadius:8,padding:"9px 10px",border:`0.5px solid ${isNeg?"var(--color-border-danger)":"var(--color-border-tertiary)"}`}}>
              <div style={{fontSize:"10px",color:"var(--color-text-secondary)",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{kisaAd(p.nameTR)}</div>
              <div style={{display:"flex",alignItems:"baseline",gap:4}}>
                <span style={{fontSize:"20px",fontWeight:500,color:isNeg?"var(--color-text-danger)":"var(--color-text-primary)"}}>{stock}</span>
                <span style={{fontSize:"10px",color:"var(--color-text-tertiary)"}}>stok</span>
              </div>
              {target > 0 && <>
                <div style={{fontSize:"10px",color:"var(--color-text-tertiary)",marginTop:3}}>{actual}/{target} hazır</div>
                <div style={{height:3,background:"var(--color-border-tertiary)",borderRadius:2,marginTop:3}}>
                  <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:2,transition:"width 0.4s"}}/>
                </div>
              </>}
              <div style={{fontSize:"10px",color:"var(--color-text-tertiary)",marginTop:3}}>max {getModelMax(pid)}/gün</div>
            </div>
          );
        })}
      </div>

      {/* Ana tablo */}
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",fontSize:"12px",tableLayout:"auto"}}>
          <thead>
            <tr>
              <th style={{...TH,textAlign:"left",minWidth:110,position:"sticky",left:0,zIndex:3,padding:"5px 8px"}}>Ürün</th>
              {calDays.map(d => {
                const isS = shipDates.has(d);
                const isW = isWeekend(d);
                const isT = d === today;
                return (
                  <th key={d} style={{...TH,minWidth:50,background:isS?"rgba(56,138,221,0.1)":isW?"rgba(250,200,50,0.07)":isT?"var(--color-background-info)":"var(--color-background-secondary)",borderLeft:isT?"2px solid var(--color-border-info)":""}}>
                    {isS && <div style={{fontSize:"9px",color:"#185FA5",fontWeight:600,lineHeight:1.1,marginBottom:1}}>SEVKİYAT</div>}
                    <div style={{fontSize:"10px",color:"var(--color-text-secondary)",lineHeight:1}}>{GUNLER[new Date(d).getDay()]}</div>
                    <div style={{fontSize:"11px",fontWeight:500}}>{fmtDate(d)}</div>
                  </th>
                );
              })}
              <th style={{...TH,minWidth:52}}>Toplam</th>
              <th style={{...TH,minWidth:52}}>Hedef</th>
              <th style={{...TH,minWidth:52}}>Kalan</th>
            </tr>
          </thead>
          <tbody>
            {anaProducts.map(p => {
              const pid = p.id;
              const modelMax = getModelMax(pid);
              const actual = totalActuals[pid] || 0;
              const target = shipTargets[pid] || 0;
              const kalan = target - actual;
              const kalanColor = kalan>0?"var(--color-text-danger)":kalan<0?"var(--color-text-warning)":"var(--color-text-success)";
              let cumActual = 0;

              return (
                <Fragment key={pid}>
                  {/* PLN satırı */}
                  <tr style={{borderTop:"1.5px solid var(--color-border-secondary)"}}>
                    <td rowSpan={2} style={{...TD,position:"sticky",left:0,background:"var(--color-background-primary)",zIndex:2,padding:"6px 8px",verticalAlign:"middle"}}>
                      <div style={{display:"flex",alignItems:"center",gap:5}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                        <span style={{fontWeight:500,fontSize:"12px"}}>{kisaAd(p.nameTR)}</span>
                      </div>
                      <div style={{fontSize:"10px",color:"var(--color-text-tertiary)",marginTop:2,paddingLeft:12}}>max {modelMax}/gün</div>
                    </td>
                    {calDays.map(d => {
                      const isS = shipDates.has(d);
                      const isW = isWeekend(d);
                      const isT = d === today;
                      const v = ms.days?.[d]?.planned?.[pid];
                      const overModel = v > modelMax;
                      const bg = isS?"rgba(56,138,221,0.06)":isW?"rgba(250,200,50,0.04)":isT?"rgba(56,138,221,0.03)":"";
                      return (
                        <td key={d} style={{...TD,textAlign:"center",background:bg,borderLeft:isT?"2px solid var(--color-border-info)":"",verticalAlign:"middle",paddingBottom:1}}>
                          <div style={{fontSize:"9px",color:"var(--color-text-tertiary)",lineHeight:1.2}}>pln</div>
                          {canPlan
                            ? <input type="number" min="0" defaultValue={v||""} placeholder="—" onBlur={e=>updateCell(d,pid,"planned",e.target.value)}
                                style={{...INP,color:overModel?"var(--color-text-warning)":v?"var(--color-text-secondary)":"var(--color-text-tertiary)"}}/>
                            : <span style={{fontSize:"12px",color:"var(--color-text-secondary)"}}>{v||"—"}</span>
                          }
                        </td>
                      );
                    })}
                    <td rowSpan={2} style={{...TD,textAlign:"center",background:"var(--color-background-secondary)",verticalAlign:"middle",fontWeight:500,fontSize:"14px"}}>{actual}</td>
                    <td rowSpan={2} style={{...TD,textAlign:"center",background:"var(--color-background-secondary)",verticalAlign:"middle",fontWeight:500,fontSize:"14px"}}>{target||"—"}</td>
                    <td rowSpan={2} style={{...TD,textAlign:"center",background:"var(--color-background-secondary)",verticalAlign:"middle",fontWeight:600,fontSize:"14px",color:kalanColor}}>{target>0?(kalan>0?"+"+kalan:kalan):"—"}</td>
                  </tr>
                  {/* GER satırı */}
                  <tr>
                    {calDays.map(d => {
                      const isS = shipDates.has(d);
                      const isW = isWeekend(d);
                      const isT = d === today;
                      const av = ms.days?.[d]?.actual?.[pid];
                      const pv = ms.days?.[d]?.planned?.[pid];
                      const behind = pv > 0 && av !== undefined && Number(av) < Number(pv);
                      const bg = isS?"rgba(56,138,221,0.06)":isW?"rgba(250,200,50,0.04)":isT?"rgba(56,138,221,0.03)":"";
                      cumActual += Number(av)||0;
                      const pct = target > 0 ? Math.min(100,Math.round((cumActual/target)*100)) : 0;
                      const barCol = pct>=100?"var(--color-background-success)":pct>=60?"var(--color-background-warning)":"var(--color-background-danger)";
                      return (
                        <td key={d} style={{...TD,textAlign:"center",background:bg,borderLeft:isT?"2px solid var(--color-border-info)":"",verticalAlign:"top",paddingTop:1}}>
                          <div style={{fontSize:"9px",color:"var(--color-text-tertiary)",lineHeight:1.2}}>ger</div>
                          {canActual
                            ? <input type="number" min="0" defaultValue={av!==undefined&&av!==0?av:""} placeholder="—" onBlur={e=>updateCell(d,pid,"actual",e.target.value)}
                                style={{...INP,color:behind?"var(--color-text-danger)":av?"var(--color-text-primary)":"var(--color-text-tertiary)",borderBottom:behind?"1px solid var(--color-border-danger)":""}}/>
                            : <span style={{fontSize:"12px",color:behind?"var(--color-text-danger)":"var(--color-text-secondary)"}}>{av!==undefined?av:"—"}</span>
                          }
                          {target>0 && <div style={{height:2,background:"var(--color-border-tertiary)",borderRadius:1,margin:"2px 3px 0"}}>
                            <div style={{height:"100%",width:`${pct}%`,background:barCol,borderRadius:1}}/>
                          </div>}
                        </td>
                      );
                    })}
                  </tr>
                </Fragment>
              );
            })}

            {/* Hat kapasitesi satırı */}
            <tr style={{borderTop:"2px solid var(--color-border-secondary)"}}>
              <td style={{...TD,position:"sticky",left:0,background:"var(--color-background-secondary)",zIndex:2,padding:"5px 8px"}}>
                <div style={{fontSize:"11px",fontWeight:500,color:"var(--color-text-secondary)"}}>Hat kapasitesi</div>
                <div style={{fontSize:"10px",color:"var(--color-text-tertiary)"}}>max {hatMax}/gün</div>
              </td>
              {calDays.map(d => {
                const isS = shipDates.has(d);
                const isW = isWeekend(d);
                const isT = d === today;
                const dayData = ms.days?.[d] || {};
                const planTotal = anaProducts.reduce((s,p) => s+(Number(dayData.planned?.[p.id])||0), 0);
                const actTotal  = anaProducts.reduce((s,p) => s+(Number(dayData.actual?.[p.id])||0), 0);
                const pPct = Math.min(100,Math.round((planTotal/hatMax)*100));
                const aPct = Math.min(100,Math.round((actTotal/hatMax)*100));
                const over = planTotal > hatMax;
                const barCol = over?"var(--color-background-danger)":pPct>80?"var(--color-background-warning)":"var(--color-background-success)";
                const bg = isS?"rgba(56,138,221,0.06)":isW?"rgba(250,200,50,0.04)":isT?"rgba(56,138,221,0.03)":"var(--color-background-secondary)";
                return (
                  <td key={d} style={{...TD,textAlign:"center",background:bg,borderLeft:isT?"2px solid var(--color-border-info)":"",padding:"4px 3px",verticalAlign:"middle"}}>
                    <div style={{fontSize:"11px",fontWeight:500,color:over?"var(--color-text-danger)":"var(--color-text-primary)"}}>{planTotal||"—"}</div>
                    {actTotal>0&&<div style={{fontSize:"10px",color:"var(--color-text-secondary)"}}>/{actTotal}</div>}
                    <div style={{height:3,background:"var(--color-border-tertiary)",borderRadius:2,margin:"3px 2px 1px"}}>
                      <div style={{height:"100%",width:`${pPct}%`,background:barCol,borderRadius:2}}/>
                    </div>
                    {over && <div style={{fontSize:"9px",color:"var(--color-text-danger)",lineHeight:1}}>⚠ FM</div>}
                  </td>
                );
              })}
              <td colSpan={3} style={{...TD,background:"var(--color-background-secondary)"}}/>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div style={{display:"flex",gap:14,marginTop:10,flexWrap:"wrap"}}>
        {[["rgba(56,138,221,0.15)","Sevkiyat günü"],["rgba(250,200,50,0.15)","Haftasonu"],["var(--color-background-danger)","Kapasite aşımı / ⚠ FM = fazla mesai"]].map(([c,l])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:"11px",color:"var(--color-text-secondary)"}}>
            <div style={{width:12,height:12,borderRadius:2,background:c}}/>
            {l}
          </div>
        ))}
      </div>

      {/* Kapasite Ayarları Modal */}
      {showSettings && tmpCap && (
        <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:50,minHeight:400}}>
          <div style={{background:"var(--color-background-primary)",borderRadius:12,padding:"1.5rem",width:360,border:"0.5px solid var(--color-border-tertiary)"}}>
            <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Kapasite Ayarları</h3>
            <div style={{marginBottom:"1rem"}}>
              <label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Günlük hat kapasitesi (toplam adet)</label>
              <input type="number" min="1" value={tmpCap.hatMax||8} onChange={e=>setTmpCap(p=>({...p,hatMax:Number(e.target.value)}))}
                style={{width:"100%",fontSize:14,padding:"6px 10px",borderRadius:6}}/>
            </div>
            <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",marginBottom:8}}>Model bazlı günlük maksimum</div>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:"1rem"}}>
              {anaProducts.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                  <span style={{flex:1,fontSize:13}}>{kisaAd(p.nameTR)}</span>
                  <input type="number" min="1" value={tmpCap.modelMax?.[p.id]||""} placeholder="sınırsız"
                    onChange={e=>setTmpCap(prev=>{const n=deepClone(prev);if(!n.modelMax)n.modelMax={};n.modelMax[p.id]=Number(e.target.value)||0;return n;})}
                    style={{width:70,fontSize:13,padding:"4px 8px",borderRadius:6,textAlign:"center"}}/>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowSettings(false)} style={{padding:"7px 16px",fontSize:13,cursor:"pointer"}}>İptal</button>
              <button onClick={saveCapacity} style={{padding:"7px 16px",fontSize:13,cursor:"pointer",background:"var(--color-background-info)",color:"var(--color-text-info)",border:"0.5px solid var(--color-border-info)",borderRadius:6,fontWeight:500}}>Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
