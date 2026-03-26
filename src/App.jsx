import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, ReferenceLine } from "recharts";
import { auth, db } from "./firebase";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

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

const fmtDate = d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"});
const shortDate = d => new Date(d).toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit"});

const TODAY = new Date();
TODAY.setHours(0,0,0,0);
const isShipped = (c) => {
  const d = new Date(c.date);
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

export default function App() {
  // Auth states
  const [authUser, setAuthUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginError, setLoginError] = useState("");
  const [showUserMgmt, setShowUserMgmt] = useState(false);
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
  const [newP, setNewP] = useState({nameTR:"",nameEN:"",kg:""});
  const [showAddO, setShowAddO] = useState(false);
  const [orderPid, setOrderPid] = useState("");
  const [orderQty, setOrderQty] = useState("");
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
  const [selectedCids, setSelectedCids] = useState(new Set());
  const [exportLang, setExportLang] = useState("EN");
  const [selectedRow, setSelectedRow] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const inputRef = useRef(null);
  const saveTimer = useRef(null);

  const isAdmin = userRole === "admin";

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
        if (d.minKG) setMinKG(d.minKG);
        if (d.maxKG) setMaxKG(d.maxKG);
        setDataLoaded(true);
      }
    });
    return () => unsub();
  }, [authUser]);

  // Save to Firestore (debounced, admin only)
  const saveToFirestore = useCallback((data) => {
    if (!isAdmin) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(doc(db, "appData", "state"), data, { merge: true });
      } catch (e) { console.error("Save error:", e); }
    }, 1000);
  }, [isAdmin]);

  // Auto-save when data changes (admin only)
  useEffect(() => {
    if (!isAdmin || !dataLoaded) return;
    saveToFirestore({ yearsData, products, combRules, minKG, maxKG });
  }, [yearsData, products, combRules, minKG, maxKG, isAdmin, dataLoaded, saveToFirestore]);

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

  const createUser = async () => {
    if (!newUserEmail || !newUserPass || !newUserName) return;
    try {
      const currentUser = auth.currentUser;
      const resp = await createUserWithEmailAndPassword(auth, newUserEmail, newUserPass);
      await setDoc(doc(db, "users", resp.user.uid), {
        email: newUserEmail, role: newUserRole, name: newUserName
      });
      // createUserWithEmailAndPassword signs in as new user, sign back as admin
      await signOut(auth);
      // Admin needs to login again — show message
      setNewUserEmail("");setNewUserPass("");setNewUserName("");
      alert("Kullanıcı oluşturuldu! Tekrar giriş yapmanız gerekiyor.");
      setShowUserMgmt(false);
    } catch (e) {
      alert("Hata: " + e.message);
    }
  };

  // Loading screen
  if (authLoading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f7f6f3"}}>
    <div style={{textAlign:"center"}}><div style={{fontSize:36,marginBottom:10}}>📦</div><div style={{fontSize:14,color:"#5f5e5a"}}>Yükleniyor...</div></div>
  </div>;

  // Login screen
  if (!authUser) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"linear-gradient(135deg,#f7f6f3 0%,#e8f4ed 100%)"}}>
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
  </div>;

  const yd = yearsData[selYear] || {containers:[],orders:{},carryOver:{},quantities:{}};

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
    if(!isAdmin) return;
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
        if(finalVal===0) delete cq[pid]; else cq[pid]=finalVal;
        q[cid]=cq;y.quantities=q;return{...prev,[selYear]:y};
      });
    } else {
      // Editing a parent (or non-linked product) → cascade to children, preserve extras
      setYearsData(prev=>{
        const y={...prev[selYear]};const q={...y.quantities};const cq={...(q[cid]||{})};
        if(val===0) delete cq[pid]; else cq[pid]=val;
        // Cascade to children
        combRules.filter(r => r.parent === pid).forEach(rule => {
          rule.children.forEach(childId => {
            const cascadeTotal = getCascadeQty(cid, childId, pid, val);
            const extra = getExtra(cid, childId);
            const childTotal = cascadeTotal + extra;
            if(childTotal === 0) delete cq[childId]; else cq[childId] = childTotal;
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
      }).filter(Boolean).sort((a,b)=>b.totalKG-a.totalKG);
      return{date:c.date,totalKG:kg,status:st,items};
    }).filter(Boolean);
  };

  const [pdfHtml, setPdfHtml] = useState(null);

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
    const iframe=document.createElement("iframe");
    iframe.style.cssText="position:fixed;top:0;left:0;width:0;height:0;border:none;";
    document.body.appendChild(iframe);
    const doc=iframe.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}@media print{div{break-inside:avoid}}</style></head><body>${el.innerHTML}</body></html>`);
    doc.close();
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(()=>document.body.removeChild(iframe),1000);
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
    if(!newP.nameTR||!newP.kg) return;
    const id=Math.max(...products.map(p=>p.id))+1;
    const colors=["#3B8BD4","#1D9E75","#D85A30","#D4537E","#534AB7","#639922","#BA7517","#E24B4A"];
    setProducts(prev=>[...prev,{id,nameTR:newP.nameTR,nameEN:newP.nameEN||newP.nameTR,kg:parseFloat(newP.kg),color:colors[id%colors.length]}]);
    setShowAddP(false);setNewP({nameTR:"",nameEN:"",kg:""});
  };

  const addOrder = () => {
    if(!orderPid||!orderQty) return;
    const pid=Number(orderPid);
    const qty=parseInt(orderQty);
    setYearsData(prev=>{
      const y={...prev[selYear]};
      const orders={...y.orders,[pid]:(y.orders[pid]||0)+qty};
      // Cascade to linked children
      combRules.filter(r=>r.parent===pid).forEach(rule=>{
        rule.children.forEach(childId=>{
          orders[childId]=(orders[childId]||0)+qty;
        });
      });
      return{...prev,[selYear]:{...y,orders}};
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
    if(s.toBePlanned>0) return {id:0,label:"Planlanacak",color:"#1D9E75",bg:"#f3faf7",bgZ:"#e8f4ed",bgSel:"#b8e0cc"};
    if(s.remaining>0) return {id:1,label:"Sevk bekliyor",color:"#3B8BD4",bg:"#f0f6fc",bgZ:"#e3eef8",bgSel:"#b5d4f0"};
    return {id:2,label:"Tamamlandı",color:"#E24B4A",bg:"#fdf3f3",bgZ:"#f8eaea",bgSel:"#f0c8c8"};
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

  const nav=[{id:"planning",icon:"📋",l:"Sevkiyat Planı"},{id:"products",icon:"📦",l:"Ürünler"},{id:"combine",icon:"🔗",l:"Kombine Ürünler"},{id:"dashboard",icon:"📊",l:"Dashboard"},{id:"shipment",icon:"🚛",l:"Sevkiyat Detay"}];

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

  const iS={width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid var(--color-border-secondary)",background:"var(--color-background-secondary)",color:"var(--color-text-primary)",fontSize:13,outline:"none",boxSizing:"border-box"};
  const bP={padding:"8px 18px",borderRadius:8,border:"none",background:"#534AB7",color:"#fff",fontSize:13,fontWeight:500,cursor:"pointer"};
  const bS={padding:"8px 18px",borderRadius:8,border:"1px solid var(--color-border-secondary)",background:"transparent",color:"var(--color-text-primary)",fontSize:13,cursor:"pointer"};

  return (
    <div style={{display:"flex",height:"100vh",fontFamily:"system-ui,sans-serif",color:"var(--color-text-primary)",background:"var(--color-background-tertiary)",overflow:"hidden"}}>
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
            <span style={{padding:"1px 6px",borderRadius:4,fontSize:9,fontWeight:600,background:isAdmin?"rgba(83,74,183,0.15)":"rgba(29,158,117,0.15)",color:isAdmin?"#534AB7":"#1D9E75"}}>{isAdmin?"ADMİN":"GÖRÜNTÜLEYICI"}</span>
            <span style={{fontSize:9,overflow:"hidden",textOverflow:"ellipsis"}}>{authUser?.email}</span>
          </div>
          <div style={{display:"flex",gap:4}}>
            {isAdmin&&<button onClick={()=>setShowUserMgmt(true)} style={{...bS,padding:"2px 6px",fontSize:9}}>Kullanıcılar</button>}
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
              {isAdmin&&<button onClick={()=>setShowAddC(true)} style={{...bP,padding:"4px 14px",fontSize:11}}>+ Sevkiyat</button>}
              {isAdmin&&<button onClick={()=>setShowAddO(true)} style={{...bS,padding:"4px 14px",fontSize:11}}>+ Sipariş</button>}
            </>}
            {isAdmin&&page==="products"&&<button onClick={()=>setShowAddP(true)} style={bP}>+ Ürün</button>}
            {!isAdmin&&<span style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:"rgba(29,158,117,0.1)",color:"#1D9E75"}}>Görüntüleme modu</span>}
          </div>
        </div>

        {/* Content */}
        <div style={{flex:1,overflow:"auto",padding:page==="planning"?0:20}}>
          {/* PLANNING GRID */}
          {page==="planning"&&<div style={{overflow:"auto",height:"100%"}}>
            <table style={{borderCollapse:"separate",borderSpacing:0,fontSize:11,minWidth:"100%"}}>
              <thead>
                <tr style={{position:"sticky",top:0,zIndex:20}}>
                  <th colSpan={6} style={{position:"sticky",left:0,zIndex:30,background:"#ffffff",padding:"4px 6px",textAlign:"left",borderBottom:"2px solid var(--color-border-tertiary)",fontSize:10,fontWeight:600,color:"var(--color-text-secondary)",minWidth:528,boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}}>
                    <span>KG </span><span style={{fontSize:9,fontWeight:400,color:"var(--color-text-tertiary)"}}>({minKG.toLocaleString()}–{maxKG.toLocaleString()})</span>
                  </th>
                  {yd.containers.map(c=>{
                    const kg=getCKG(c.id);const st=getStatus(kg);const fill=maxKG>0?Math.min(kg/maxKG*100,100):0;
                    return <th key={c.id} style={{background:st.bg,padding:"3px 3px",textAlign:"center",borderBottom:`2px solid ${st.c}`,minWidth:66,transition:"background 0.2s"}}>
                      <div style={{fontSize:9,fontWeight:700,color:st.c}}>{st.i} {st.l}</div>
                      <div style={{fontSize:10,fontWeight:600,color:st.c}}>{Math.round(kg).toLocaleString()}</div>
                      <div style={{height:4,background:"var(--color-background-tertiary)",borderRadius:2,overflow:"hidden",position:"relative"}}>
                        <div style={{position:"absolute",left:`${maxKG>0?minKG/maxKG*100:0}%`,top:0,bottom:0,width:1,background:"var(--color-text-tertiary)",opacity:0.5,zIndex:1}}/>
                        <div style={{height:"100%",width:`${fill}%`,borderRadius:2,background:st.c,transition:"width 0.3s"}}/>
                      </div>
                    </th>;
                  })}
                  <th style={{background:"var(--color-background-primary)",borderBottom:"2px solid var(--color-border-tertiary)",minWidth:45}}/>
                </tr>
                <tr style={{position:"sticky",top:46,zIndex:20}}>
                  <th style={{position:"sticky",left:0,zIndex:30,background:"#f7f6f3",padding:"6px 6px",textAlign:"left",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:10,fontWeight:600,minWidth:300}}>ÜRÜN</th>
                  <th style={{position:"sticky",left:300,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:42,color:"#D85A30"}} title="Önceki Yıldan Devir">DEVİR</th>
                  <th style={{position:"sticky",left:342,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:42,color:"#534AB7"}} title="Yeni Sipariş">YENİ</th>
                  <th style={{position:"sticky",left:384,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#0F6E56"}} title="Toplam Planlanan (sevk edilen dahil)">PLANLI</th>
                  <th style={{position:"sticky",left:432,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#BA7517"}} title="Planlanacak Kalan">P.KALAN</th>
                  <th style={{position:"sticky",left:480,zIndex:30,background:"#f7f6f3",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:48,color:"#E24B4A",boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}} title="Sevk Edilecek Kalan (toplam sipariş - sevk edilen)">S.KALAN</th>
                  {yd.containers.map(c=>(
                    <th key={c.id} style={{background:"var(--color-background-secondary)",padding:"3px 2px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",minWidth:66}}>
                      {editDateId===c.id?<div>
                        <input type="date" value={editDateVal} onChange={e=>setEditDateVal(e.target.value)} onBlur={()=>saveDate(c.id)} onKeyDown={e=>{if(e.key==="Enter")saveDate(c.id);if(e.key==="Escape")setEditDateId(null);}} autoFocus style={{width:58,fontSize:9,padding:"2px",border:"1px solid #534AB7",borderRadius:3,background:"var(--color-background-primary)",color:"var(--color-text-primary)",outline:"none"}}/>
                      </div>
                      :<div onClick={()=>{if(isAdmin){setEditDateId(c.id);setEditDateVal(c.date);}}} style={{cursor:isAdmin?"pointer":"default"}} title={isAdmin?"Tarihi değiştirmek için tıklayın":""}>
                        <div style={{fontSize:9,fontWeight:500}}>{shortDate(c.date)}</div>
                        <Badge status={isShipped(c)?"shipped":"planned"}/>
                      </div>}
                    </th>
                  ))}
                  <th style={{background:"var(--color-background-secondary)",padding:"6px 3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontSize:9,fontWeight:600,minWidth:45,color:"#1D9E75"}}>SVK</th>
                </tr>
              </thead>
              <tbody>
                {activeProducts.map((p,idx)=>{
                  const s=getPStats(p.id);
                  const g=getProductGroup(p.id);
                  const prevG=idx>0?getProductGroup(activeProducts[idx-1].id):null;
                  const showGroupHeader=!prevG||prevG.id!==g.id;
                  const colCount=6+yd.containers.length+1;
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
                    <td style={{position:"sticky",left:342,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:(yd.orders[p.id]||0)>0?"#534AB7":"var(--color-text-tertiary)"}}>{yd.orders[p.id]||"–"}</td>
                    <td style={{position:"sticky",left:384,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.planned>0?"#0F6E56":"var(--color-text-tertiary)"}}>{s.planned}</td>
                    <td style={{position:"sticky",left:432,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.toBePlanned>0?"#BA7517":"var(--color-text-tertiary)"}}>{s.toBePlanned}</td>
                    <td style={{position:"sticky",left:480,zIndex:10,background:rowBg,padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:10,color:s.remaining>0?"#E24B4A":"var(--color-text-tertiary)",boxShadow:"4px 0 8px rgba(0,0,0,0.08)"}}>{s.remaining}</td>
                    {yd.containers.map(c=>{
                      const q=(yd.quantities[c.id]||{})[p.id]||0;
                      const isE=editCell?.cid===c.id&&editCell?.pid===p.id;
                      const linked=isLinkedChild(p.id)&&q>0;
                      const extra=getExtra(c.id,p.id);
                      const linkedParents=linked?getLinkedParents(c.id,p.id):[];
                      const cascadeMin=isLinkedChild(p.id)?getCascadeQty(c.id,p.id,null,0):0;
                      const maxAllowed=s.toBePlanned+q;
                      return <td key={c.id} onClick={(e)=>{e.stopPropagation();if(!isShipped(c)&&s.toBePlanned+q>0)cellClick(c.id,p.id,q);}} style={{padding:"1px 1px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",cursor:isShipped(c)||(s.toBePlanned<=0&&q===0)?"default":"pointer",minWidth:66,background:isE?"var(--color-background-info)":linked?"rgba(83,74,183,0.08)":isShipped(c)?`${g.color}08`:"transparent"}} title={linked?(extra>0?`Cascade: ${q-extra} + Ekstra: ${extra}`:`Bağlı: ${linkedParents.map(pid=>products.find(pp=>pp.id===pid)?.nameTR).join(" + ")}`):(s.toBePlanned<=0&&q===0?"Planlanacak kalan yok":"")}> 
                        {isE?<div>
                          <input ref={inputRef} type="number" min={cascadeMin} max={maxAllowed} value={editValue} onChange={e=>setEditValue(e.target.value)} onBlur={cellSave} onKeyDown={cellKey} style={{width:48,padding:"1px 3px",border:`1px solid ${cascadeMin>0?"#534AB7":"#534AB7"}`,borderRadius:3,textAlign:"center",fontSize:11,background:"var(--color-background-primary)",color:"var(--color-text-primary)",outline:"none"}}/>
                          <div style={{fontSize:7,marginTop:1,display:"flex",justifyContent:"center",gap:4}}>
                            {cascadeMin>0&&<span style={{color:"#534AB7"}}>min:{cascadeMin}</span>}
                            <span style={{color:"#BA7517"}}>max:{maxAllowed}</span>
                          </div>
                        </div>
                        :linked?<span style={{fontSize:10,fontWeight:500,color:"#534AB7"}}><span style={{fontSize:8}}>&#9741;</span> {q}{extra>0&&<span style={{fontSize:8,color:"#BA7517"}}> +{extra}</span>}</span>
                        :<span style={{fontSize:11,fontWeight:q>0?500:400,color:q>0?(isShipped(c)?"#1D9E75":"var(--color-text-primary)"):"var(--color-text-tertiary)"}}>{q>0?q:"·"}</span>}
                      </td>;
                    })}
                    <td style={{padding:"3px",textAlign:"center",borderBottom:"1px solid var(--color-border-tertiary)",fontWeight:600,fontSize:11,color:"#1D9E75"}}>{s.shipped}</td>
                  </tr></>;
                })}
              </tbody>
            </table>
            {activeProducts.length===0&&<div style={{textAlign:"center",padding:50,color:"var(--color-text-tertiary)"}}><div style={{fontSize:36,marginBottom:10}}>📦</div>Bu yıl için sipariş bulunmuyor veya arama sonucu yok.</div>}
          </div>}

          {/* PRODUCTS */}
          {page==="products"&&<div>
            <input placeholder="Ürün ara..." value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,width:300,marginBottom:16}}/>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
              {products.filter(p=>!search||p.nameTR.toLowerCase().includes(search.toLowerCase())||p.nameEN.toLowerCase().includes(search.toLowerCase())).map(p=>(
                <div key={p.id} style={{background:"var(--color-background-primary)",borderRadius:10,padding:12,border:"1px solid var(--color-border-tertiary)",display:"flex",gap:10}}>
                  <div style={{width:4,height:36,borderRadius:2,background:p.color,flexShrink:0,marginTop:2}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:1}}>
                      <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"var(--color-background-tertiary)",color:"var(--color-text-tertiary)",fontWeight:600}}>#{p.id}</span>
                      {isLinkedChild(p.id)&&<span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:"rgba(83,74,183,0.15)",color:"#534AB7",fontWeight:600}}>BAĞLI</span>}
                      <span style={{fontSize:12,fontWeight:500}}>{p.nameTR}</span>
                    </div>
                    <div style={{fontSize:10,color:"var(--color-text-tertiary)",marginBottom:4}}>{p.nameEN}</div>
                    <span style={{fontSize:10,color:"var(--color-text-secondary)"}}>Ağırlık: <b>{p.kg} KG</b></span>
                  </div>
                </div>
              ))}
            </div>
          </div>}

          {/* COMBINE RULES */}
          {page==="combine"&&<div>
            <div style={{marginBottom:16,padding:12,borderRadius:8,background:"var(--color-background-info)",fontSize:12,color:"var(--color-text-info)"}}>
              Ana ürün planlandığında bağlı ürünler aynı miktarda otomatik eklenir. Bağlı ürün hücreleri mor renkte ve kilitli görünür.
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
              {combRules.map((rule,i)=>{
                const parent=products.find(p=>p.id===rule.parent);
                const children=rule.children.map(cid=>products.find(p=>p.id===cid)).filter(Boolean);
                return <div key={i} style={{background:"var(--color-background-primary)",borderRadius:10,padding:14,border:"1px solid var(--color-border-tertiary)",display:"flex",alignItems:"center",gap:12}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:500,color:"#534AB7",marginBottom:4}}>{parent?.nameTR||`ID:${rule.parent}`}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {children.map(ch=><span key={ch.id} style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:"rgba(83,74,183,0.1)",color:"#534AB7"}}>{ch.nameTR}</span>)}
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"var(--color-text-tertiary)",whiteSpace:"nowrap"}}>1:1</div>
                  {isAdmin&&<button onClick={()=>setCombRules(prev=>prev.filter((_,j)=>j!==i))} style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:"#E24B4A",padding:4}} title="Kuralı sil">✕</button>}
                </div>;
              })}
            </div>
            {isAdmin&&<div style={{background:"var(--color-background-primary)",borderRadius:10,padding:16,border:"1px dashed var(--color-border-secondary)"}}>
              <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Yeni kural ekle</div>
              <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div style={{flex:1,minWidth:200}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Ana ürün</label>
                  <select value={newRuleParent} onChange={e=>setNewRuleParent(e.target.value)} style={iS}>
                    <option value="">Seçin...</option>
                    {products.filter(p=>!isLinkedChild(p.id)).map(p=><option key={p.id} value={p.id}>{p.nameTR} ({p.kg} KG)</option>)}
                  </select>
                </div>
                <div style={{flex:2,minWidth:300}}>
                  <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Bağlı ürünler (virgülle ID)</label>
                  <input value={newRuleChildren} onChange={e=>setNewRuleChildren(e.target.value)} style={iS} placeholder="Ürün ID'leri: 17, 14"/>
                </div>
                <button onClick={()=>{
                  if(!newRuleParent||!newRuleChildren) return;
                  const children=newRuleChildren.split(",").map(s=>parseInt(s.trim())).filter(n=>n>0);
                  if(children.length===0) return;
                  setCombRules(prev=>[...prev,{parent:parseInt(newRuleParent),children}]);
                  setNewRuleParent("");setNewRuleChildren("");
                }} style={bP}>Ekle</button>
              </div>
              <div style={{marginTop:10,fontSize:10,color:"var(--color-text-tertiary)"}}>
                Ürün ID'lerini Ürünler sayfasından bulabilirsiniz. Birden fazla bağlı ürün eklemek için virgülle ayırın.
              </div>
            </div>}
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
            const estRemainingC=avgKGperC>0?Math.ceil(remainingKG/avgKGperC):0;

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
              }).filter(Boolean).sort((a,b)=>b.totalKG-a.totalKG);
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
              </div>;
            })}
          </div></div>}
        </div>
      </div>

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
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Adı (TR)</label>
            <input value={newP.nameTR} onChange={e=>setNewP({...newP,nameTR:e.target.value})} style={iS}/></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Adı (EN)</label>
            <input value={newP.nameEN} onChange={e=>setNewP({...newP,nameEN:e.target.value})} style={iS}/></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>KG</label>
            <input type="number" value={newP.kg} onChange={e=>setNewP({...newP,kg:e.target.value})} style={iS}/></div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={()=>setShowAddP(false)} style={bS}>İptal</button><button onClick={addProduct} style={bP}>Ekle</button></div>
      </Modal>}

      {showAddO&&<Modal title="Sipariş Ekle" onClose={()=>setShowAddO(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Ürün</label>
            <select value={orderPid} onChange={e=>setOrderPid(e.target.value)} style={iS}>
              <option value="">Seçin...</option>
              {products.map(p=><option key={p.id} value={p.id}>{p.nameTR} ({p.kg} KG)</option>)}
            </select></div>
          <div><label style={{fontSize:12,color:"var(--color-text-secondary)",display:"block",marginBottom:4}}>Miktar</label>
            <input type="number" value={orderQty} onChange={e=>setOrderQty(e.target.value)} style={iS}/></div>
          <div style={{fontSize:10,color:"var(--color-text-tertiary)"}}>Yıl: {selYear}</div>
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
        <div onClick={e=>e.stopPropagation()} style={{background:"var(--color-background-primary)",borderRadius:12,padding:24,width:400,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <h3 style={{margin:"0 0 16px",fontSize:16,fontWeight:600}}>Kullanıcı Yönetimi</h3>
          <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
            <div>
              <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>İsim</label>
              <input value={newUserName} onChange={e=>setNewUserName(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="Ömer"/>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Email</label>
              <input type="email" value={newUserEmail} onChange={e=>setNewUserEmail(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="kullanici@sirket.com"/>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Şifre</label>
              <input type="password" value={newUserPass} onChange={e=>setNewUserPass(e.target.value)} style={{width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",fontSize:12,outline:"none"}} placeholder="En az 6 karakter"/>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--color-text-secondary)",display:"block",marginBottom:3}}>Rol</label>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setNewUserRole("admin")} style={{flex:1,padding:"8px",borderRadius:6,border:`2px solid ${newUserRole==="admin"?"#534AB7":"rgba(0,0,0,0.12)"}`,background:newUserRole==="admin"?"rgba(83,74,183,0.1)":"transparent",color:newUserRole==="admin"?"#534AB7":"var(--color-text-secondary)",fontSize:12,fontWeight:500,cursor:"pointer"}}>Admin</button>
                <button onClick={()=>setNewUserRole("viewer")} style={{flex:1,padding:"8px",borderRadius:6,border:`2px solid ${newUserRole==="viewer"?"#1D9E75":"rgba(0,0,0,0.12)"}`,background:newUserRole==="viewer"?"rgba(29,158,117,0.1)":"transparent",color:newUserRole==="viewer"?"#1D9E75":"var(--color-text-secondary)",fontSize:12,fontWeight:500,cursor:"pointer"}}>Görüntüleyici</button>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setShowUserMgmt(false)} style={{padding:"8px 16px",borderRadius:6,border:"1px solid rgba(0,0,0,0.15)",background:"transparent",fontSize:12,cursor:"pointer"}}>Kapat</button>
            <button onClick={createUser} style={{padding:"8px 16px",borderRadius:6,border:"none",background:"#534AB7",color:"#fff",fontSize:12,fontWeight:500,cursor:"pointer"}}>Kullanıcı Oluştur</button>
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
