import { IDXDB, SecondaryValue, SecondaryIterator } from "./idxdb";
import { DBI64, PrimaryIterator, PrimaryValue } from "./dbi64";
import { Name } from "./name";
import { check } from "./system";

export const SAME_PAYER = new Name();

const noAvailablePrimaryKey = <u64>(-2) // Must be the smallest uint64_t value compared to all other tags
const unsetNextPrimaryKey = <u64>(-1) // No table

export interface MultiIndexValue extends PrimaryValue {
    getSecondaryValue(index: usize): SecondaryValue;
    setSecondaryValue(index: usize, value: SecondaryValue): void;
}

export class MultiIndex<T extends MultiIndexValue> {
    db: DBI64<T>;
    idxdbs: Array<IDXDB>;
    nextPrimaryKey: u64 = unsetNextPrimaryKey;

    constructor(code: Name, scope: Name, table: Name, indices: Array<IDXDB> = []) {
        this.db = new DBI64(code.N, scope.N, table.N);
        this.idxdbs = indices;
    }

    set(value: T, payer: Name): PrimaryIterator<T> {
        let it = this.find(value.getPrimaryValue());
        if (it.isOk()) {
            this.update(it, value, payer);
        } else {
            it = this.store(value, payer);
        }
        return it
    }

    store(value: T, payer: Name): PrimaryIterator<T> {
        const it = this.db.store(value.getPrimaryValue(), value, payer.N);
        for (let i=0; i<this.idxdbs.length; i++) {
            this.idxdbs[i].storeEx(value.getPrimaryValue(), value.getSecondaryValue(i), payer.N);
        }

        const pk = value.getPrimaryValue()
        if (pk >= this.nextPrimaryKey) {
            this.nextPrimaryKey = (pk >= noAvailablePrimaryKey) ? noAvailablePrimaryKey : (pk + 1);
        }
        
        return it;
    }

    update(it: PrimaryIterator<T>, value: T, payer: Name): void {
        check(it.isOk(), "update:bad iterator");
        let primary = value.getPrimaryValue();
        check(primary == it.primary, "primary key can't be changed during update!");
        this.db.update(it, payer.N, value);
        for (let i=0; i<this.idxdbs.length; i++) {
            let ret = this.idxdbs[i].findPrimaryEx(primary);
            let newValue = value.getSecondaryValue(i);
            if (ret.value.type == newValue.type && ret.value.value == newValue.value) {
                continue;
            }
            this.idxdbs[i].updateEx(ret.i, value.getSecondaryValue(i), payer.N);
        }

        if (primary >= this.nextPrimaryKey) {
            this.nextPrimaryKey = (primary >= noAvailablePrimaryKey) ? noAvailablePrimaryKey : (primary + 1);
        }
    }

    remove(iterator: PrimaryIterator<T>): void {
        let value = this.get(iterator);
        let primary = value.getPrimaryValue();
        this.removeEx(primary);
    }

    removeEx(primary: u64): void {
        let it = this.find(primary);
        check(it.isOk(), "primary value not found!");
        this.db.remove(it);
        for (let i=0; i<this.idxdbs.length; i++) {
            let ret = this.idxdbs[i].findPrimaryEx(primary);
            if (ret.i.isOk()) {
                this.idxdbs[i].remove(ret.i);
            }
        }
    }

    get(iterator: PrimaryIterator<T>): T {
        let ret = this.db.get(iterator);
        if (ret) {
            return ret;
        }

        ret = instantiate<T>();
        return ret;
    }

    getByKey(primary: u64): T | null {
        let iterator = this.find(primary);
        if (!iterator.isOk()) {
            return null;
        }

        let data = this.db.get(iterator);
        return data;
    }

    next(iterator: PrimaryIterator<T>): PrimaryIterator<T> {
        return this.db.next(iterator);
    }

    previous(iterator: PrimaryIterator<T>): PrimaryIterator<T> {
        return this.db.previous(iterator);
    }

    find(id: u64): PrimaryIterator<T> {
        return this.db.find(id);
    }

    requireFind(id: u64, findError: string = `Could not find item with id ${id}`): PrimaryIterator<T> {
        let itr = this.find(id);
        check(itr.isOk(), findError);
        return itr;
    }

    requireNotFind(id: u64, notFindError: string = `Item with id ${id} exists`): PrimaryIterator<T> {
        let itr = this.find(id);
        check(!itr.isOk(), notFindError);
        return itr;
    }

    lowerBound(id: u64): PrimaryIterator<T> {
        return this.db.lowerBound(id);
    }

    upperBound(id: u64): PrimaryIterator<T> {
        return this.db.upperBound(id);
    }

    begin(): PrimaryIterator<T> {
        return this.lowerBound(u64.MIN_VALUE)
    }

    end(): PrimaryIterator<T> {
        return this.db.end();
    }

    getIdxDB(i: i32): IDXDB {
        if (i >= this.idxdbs.length) {
            check(false, "getIdxDB: bad db index");
        }
        return this.idxdbs[i];
    }

    idxUpdate(it: SecondaryIterator, idxValue: SecondaryValue, payer: Name): void {
        let primaryIt = this.find(it.primary);
        check(primaryIt.isOk(), "idxUpdate: value by primary not found");
        let value = this.get(primaryIt);
        value.setSecondaryValue(it.dbIndex, idxValue);
        this.db.update(primaryIt, payer.N, value);
        this.idxdbs[it.dbIndex].updateEx(it, idxValue, payer.N);
    }

    availablePrimaryKey(): u64 {
        if (this.nextPrimaryKey == unsetNextPrimaryKey) {
            if (this.begin().i == this.end().i) {
                this.nextPrimaryKey = 0;
            } else {
                const end = this.end();
                const itr = this.previous(end)
                const pk = this.get(itr).getPrimaryValue()
                if (pk >= noAvailablePrimaryKey) {
                    this.nextPrimaryKey = noAvailablePrimaryKey
                } else {
                    this.nextPrimaryKey = pk + 1
                }
            }
        }

        check(this.nextPrimaryKey < noAvailablePrimaryKey, "next primary key in table is at autoincrement limit")
        return this.nextPrimaryKey
    }
}
