export type MovingMoneyKind='move'|'reserve';
export type MovingMoneyResult={feature:MovingMoneyKind;ok:true;revision:number;notice:string}|{feature:MovingMoneyKind;ok:false;status:number;error:string};
export type MovingMoneyModel={
 revision:number;month:string;asOfDate:string;currency:string;known:boolean;reason:string|null;
 cashCents:number|null;readyToAssignCents:number|null;assignableCents:number|null;shortfallCents:number|null;
 categories:{id:number;name:string;availableCents:number|null;creditOverspentCents:number|null}[];
 cards:{id:number;name:string;reservedCents:number|null;cashBackedReserveCents:number|null;debtCents:number|null;unfundedCents:number|null}[];
};
export type MovingMoneySubmit=(kind:MovingMoneyKind,form:FormData)=>Promise<MovingMoneyResult>;
