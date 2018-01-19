import { inject, injectable } from 'inversify';
import { emptyCB } from '../helpers/';
import { IAccountLogic } from '../ioc/interfaces/logic';
import { IAccountsModule } from '../ioc/interfaces/modules';
import { Symbols } from '../ioc/symbols';
import { AccountFilterData, MemAccountsData } from '../logic/';
import { OptionalsMemAccounts } from '../logic';

@injectable()
export class AccountsModule implements IAccountsModule {

  @inject(Symbols.logic.account)
  private accountLogic: IAccountLogic;

  public cleanup() {
    return Promise.resolve();
  }

  public getAccount(filter: AccountFilterData, fields?: Array<(keyof MemAccountsData)>): Promise<MemAccountsData> {
    if (filter.publicKey) {
      filter.address = this.accountLogic.generateAddressByPublicKey(filter.publicKey);
      delete filter.publicKey;
    }
    return this.accountLogic.get(filter, fields);
  }

  public getAccounts(filter: AccountFilterData, fields: Array<(keyof MemAccountsData)>): Promise<MemAccountsData[]> {
    return this.accountLogic.getAll(filter, fields);
  }

  /**
   * Sets some data to specific account
   * @param {MemAccountsData} data
   * @returns {Promise<MemAccountsData>}
   */
  // tslint:disable-next-line max-line-length
  public async setAccountAndGet(data: ({ publicKey: string } | { address: string }) & OptionalsMemAccounts ): Promise<MemAccountsData> {
    if (!data.address && !data.publicKey) {
      throw new Error('Missing address and public key');
    }
    if (!data.address) {
      data.address = this.accountLogic.generateAddressByPublicKey(data.publicKey);
    }
    // no need to reset address!
    const {address} = data;
    delete data.address;

    await this.accountLogic.set(address, data);
    return this.accountLogic.get({address});
  }

  public mergeAccountAndGetSQL(diff: any): string {
    if (!diff.address && !diff.publicKey) {
      throw new Error('Missing address and public key');
    }
    if (!diff.address) {
      diff.address = this.accountLogic.generateAddressByPublicKey(diff.publicKey);
    }
    const {address} = diff;
    delete diff.address;
    return this.accountLogic.merge(address, diff);
  }

  /**
   * merge some data on the account
   * @param {MemAccountsData} data
   * @returns {Promise<MemAccountsData>}
   */

  public async mergeAccountAndGet(diff: any): Promise<MemAccountsData> {
    if (!diff.address && !diff.publicKey) {
      throw new Error('Missing address and public key');
    }
    if (!diff.address) {
      diff.address = this.accountLogic.generateAddressByPublicKey(diff.publicKey);
    }
    const {address} = diff;
    delete diff.address;

    return this.accountLogic.merge(address, diff, emptyCB);
  }

  /**
   * @deprecated
   */
  public generateAddressByPublicKey(pk: string) {
    return this.accountLogic.generateAddressByPublicKey(pk);
  }
}
