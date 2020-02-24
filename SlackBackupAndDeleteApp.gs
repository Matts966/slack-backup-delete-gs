// Googleドライブでバックアップを取りながら、不要になったファイルを消していき容量を節約するスクリプト
// https://www.virment.com/step-allow-google-apps-script/ を参考に、バックアップを管理するGoogleアカウントで作成したプロジェクトに以下のコードを.gsファイルとして保存し、編集メニューから定期実行トリガーを作成する(1日おきを想定)。

// 設定項目　適宜コード上に公開したくないものは　ファイル⇨プロジェクトのプロパティから設定して　PropertiesService.getScriptProperties().getProperty（'keyName'） で取り出すと良い。
var days = 30; // 日以上経過したファイルは削除　
var targetType = "images"; // "spaces,snippets,gdocs,zips,pdfs,images" といった形式で削除対象のファイルを列挙 空文字列の場合全て(spacesはpostのこと) 　imageだけ重そうなので削除する設定にしてみた（ｈｔｍｌなどは綺麗にバックアップとれないので注意）
var targetChannels = []; // ['random'] といった形式で対象にしたいチャンネルを列挙 空配列の場合全て
var slackApiToken = 'Your Token';　// Your Token
var dirName = 'Slack'　// バックアップ先のフォルダ名


// Main関数
function deleteOldFile(){
  　　　　//　チャンネル指定の有無で場合分け
    if (targetChannels.length > 0) {
        targetChannels.forEach(function(channelName){
            var channelId = SlackBackupAndDeleteApp.getId(channelName, 'channels') || SlackBackupAndDeleteApp.getId(channelName, 'groups');
            if(channelId === ''){
                Logger.log('Not found "' + channelName + '". Skip');
                return -1; // チャンネルが無ければ終了
            }
            Logger.log('Channel Found "' + channelName + '"(id: "' + channelId + '")');

            var deleteFiles = SlackBackupAndDeleteApp.getFileListWithCondition(channelId, days, targetType); // 削除対象を取得

            SlackBackupAndDeleteApp.backupAndDelete(channelId, deleteFiles);

            SlackBackupAndDeleteApp.postDeleteFileMessage(channelId);
        });
    } else {
        Logger.log('All delete');
        var deleteFiles = SlackBackupAndDeleteApp.getFileListWithCondition(null, days, targetType); // 削除対象を取得
      
        SlackBackupAndDeleteApp.backupAndDelete(null, deleteFiles);

        SlackBackupAndDeleteApp.postDeleteFileMessage(null);
    }
}

// SlackBackupAndDeleteApp
var SlackBackupAndDeleteApp = {};

// Token
SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN = slackApiToken; // PropertiesService.getScriptProperties().getProperty('keyName');

SlackBackupAndDeleteApp.backupAndDelete = function(channelId, deleteFiles){
  deleteFiles.files.forEach(function(file){ 
    
    if (file.public_url_shared) {
      sharedUrl = file.permalink_public;
    } else {
      var params = {
        'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
        'file': file.id
      }
      var f = SlackBackupAndDeleteApp.execute('files.sharedPublicURL', params).file;
      if (!f) {
        return
      }
      var sharedUrl = f.permalink_public;
    }
    
    // スクレイピングで素のデータURLを取得
    var html = UrlFetchApp.fetch(sharedUrl);
    var content = html.getContentText();  
    var regExp  = new RegExp( '<a.*href=\"([a-zA-Z0-9!-/:-@¥[-`{-~]+)\">\n' ) ;
    var elems = content.match(regExp);
    
    Logger.log('Scraped Text ' + elems);
    
    // 生データURLが取れる場合と取れない場合 Slackは持ってるはずだけど、HTMLなどの一部の形式はpublicでは生で渡してくれない
    if (elems != null) {
      var driveResponse = SlackBackupAndDeleteApp.uploadToGoogleDrive(elems[1]);
    } else {
      var driveResponse = SlackBackupAndDeleteApp.uploadToGoogleDrive(sharedUrl);
    }
    
    Logger.log('driveResponse ' + driveResponse);
    
    if (driveResponse.error) {
      
      Logger.log('driveResponse.error ' + driveResponse.error);
      
      var params = {
        'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
        'channel': channelId == null ? file.channels[0] : channelId,
        'username' : 'ファイル削除botくん', //投稿するbotの名前
        'text'     : 'ファイル ' + file.name + 'のバックアップに失敗しました。削除処理をスキップします。' //投稿するメッセージ
      }
      SlackBackupAndDeleteApp.execute('chat.postMessage', params);
      
    }　else {
      
      var slackResponse = SlackBackupAndDeleteApp.deleteFile(file.id);
      if (slackResponse.error){
        
        Logger.log('slackResponse.error ' + slackResponse.error);
        
        var params = {
          'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
          'channel': channelId == null ? file.channels[0] : channelId,
          'username' : 'ファイル削除botくん', //投稿するbotの名前
          'text'     : 'ファイル ' + file.name + 'の削除に失敗しました。' //投稿するメッセージ
        }
        SlackBackupAndDeleteApp.execute('chat.postMessage', params);
        
      } else {
        
        Logger.log('Mission Complete');
        
        var params = {
          'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
          'channel': channelId == null ? file.channels[0] : channelId,
          'username' : 'ファイル削除botくん', //投稿するbotの名前
          'text'     : 'ファイル ' + file.name + 'をバックアップしたのち、削除しました。' //投稿するメッセージ
        }
        SlackBackupAndDeleteApp.execute('chat.postMessage', params);
        
      }
    }
  });
}

// ファイル削除予告メッセージ送信
SlackBackupAndDeleteApp.postDeleteFileMessage = function(channelId){
    Logger.log(SlackBackupAndDeleteApp.postConfirm(channelId, days, targetType));
}

// バックアップ関数
SlackBackupAndDeleteApp.uploadToGoogleDrive = function(url) {
  var dir = DriveApp.getFoldersByName(dirName).next();
  var someFile = UrlFetchApp.fetch(url).getBlob();
  return dir.createFile(someFile);
}


// UrlFetchApp.fetchは同期的処理なのでコールバックなどはなし
SlackBackupAndDeleteApp.execute = function(method, params){
    if (params === undefined) params = {'token' : SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN};
    var options = {
        'method': 'POST',
        'payload': params
    }
    var res = UrlFetchApp.fetch('https://slack.com/api/' + method, options);
    return JSON.parse(res.getContentText());
}

// 翌日削除されるファイルを告知
SlackBackupAndDeleteApp.postConfirm = function(channelId, days, targetType){

  var deleteFiles = this.getFileListWithCondition(channelId, days - 1, targetType); // 翌日の削除対象を取得
  var listMsg = '明日、古くなった以下の' + deleteFiles.files.length + '件のファイルが削除されます。';
  
  deleteFiles.files.forEach(function(f){
    listMsg +=  "\n\t・" + f.name ;
  });
  
  listMsg += "\n削除されるファイルはGoogleDriveにバックアップされます。";

  if (deleteFiles.files.length != 0) {
    if (channelId == null) {
      var params = {
        'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
        'channel': '#general',
        'username' : 'ファイル削除botくん', //投稿するbotの名前
        'text'     : listMsg //投稿するメッセージ
      }
    } else {
        var params = {
        'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
        'channel': channelId,
        'username' : 'ファイル削除botくん', //投稿するbotの名前
        'text'     : listMsg //投稿するメッセージ
        }
    }
    return this.execute('chat.postMessage', params);
  }  
  
  return "Will Not Delete"
}

// ファイルの削除API
SlackBackupAndDeleteApp.deleteFile = function(id){
    var params = {
        'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
        'file' : id // delete対象はidで指定
    }
    return this.execute('files.delete', params);
}

// チャンネル、グループIDを取得
SlackBackupAndDeleteApp.getId = function(name, type) { // 公開->channel 非公開->group という扱いらしいのでどちらにも対応
    if(type === undefined) type = 'channels';

    var channelsList
    if(type === 'channels'){
        channelsList = this.execute('channels.list').channels;
    }else if(type ==='groups'){
        channelsList = this.execute('groups.list').groups;
    }
    Logger.log(channelsList);
    var channelId = '';
    channelsList.some(function(channels){
        if (channels.name.match(name)){
            channelId = channels.id;
            return true;
        }
    });
    return channelId;
}

// Unixtimeにしつつ時間差を求める
SlackBackupAndDeleteApp.elapsedDaysToUnixTime = function(days){
    var date = new Date();
    var now = Math.floor(date.getTime()/ 1000); // unixtime[sec]
    return now - 8.64e4 * days + '' // 8.64e4[sec] = 1[day] 文字列じゃないと動かないので型変換している
}

// 指定したタイプのファイルを削除
SlackBackupAndDeleteApp.getFileListWithCondition = function(channelId, days, targetType, count){
    if(count === undefined) count = 1000;
    if (channelId != null) {
        var params = {
            'channel': channelId,
            'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
            'count': count,
            'ts_to': SlackBackupAndDeleteApp.elapsedDaysToUnixTime(days)
        }
    }else {
        var params = {
            'token': SlackBackupAndDeleteApp.SLACK_ACCESS_TOKEN,
            'count': count,
            'ts_to': SlackBackupAndDeleteApp.elapsedDaysToUnixTime(days)
        }
    }
  

    if ('' != targetType) {
      params.types = targetType; // typeを指定
      var allFiles = this.execute('files.list', params); // 指定した形式のファイルを取ってくる   
    } else {
      var allFiles = this.execute('files.list', params); // 全てのファイルを取ってくる
    }
    
    return allFiles;
}
